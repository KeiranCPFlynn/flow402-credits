import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseEventLogs } from "viem";
import { baseSepolia } from "viem/chains";
import { createClient } from "@supabase/supabase-js";
import { anvil } from "@/lib/chain-local";
import { DEPLOYMENT_RPC_URL, TREASURY_ABI, TREASURY_ADDRESS } from "@/lib/treasury";

const tenantId = process.env.FLOW402_TENANT_ID;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fallbackUserId = process.env.DEMO_USER_ID || process.env.NEXT_PUBLIC_DEMO_USER_ID;

const chainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV?.toLowerCase();
const isLocal = chainEnv === "local";
const isBaseFork = chainEnv === "base-fork";
const selectedChain = isLocal ? anvil : baseSepolia;
const rpcSourceIsDeployment = isLocal || isBaseFork;
const rpcUrl =
    (rpcSourceIsDeployment ? DEPLOYMENT_RPC_URL : process.env.NEXT_PUBLIC_BASE_RPC_URL) ||
    selectedChain.rpcUrls.default.http[0];

const publicClient = createPublicClient({
    chain: selectedChain,
    transport: http(rpcUrl),
});

const treasuryTarget = TREASURY_ADDRESS?.toLowerCase();

type RoutePayload = {
    tx?: string;
    userId?: string;
};

async function extractPayload(req: NextRequest): Promise<RoutePayload> {
    const urlPayload: RoutePayload = {
        tx: new URL(req.url).searchParams.get("tx") ?? undefined,
        userId: new URL(req.url).searchParams.get("userId") ?? undefined,
    };

    if (urlPayload.tx && urlPayload.userId) {
        return urlPayload;
    }

    try {
        const body = await req.json();
        if (typeof body === "object" && body !== null) {
            return {
                tx: urlPayload.tx ?? (typeof body.tx === "string" ? body.tx : undefined),
                userId: urlPayload.userId ?? (typeof body.userId === "string" ? body.userId : undefined),
            };
        }
    } catch {
        // ignore body parse errors for GET requests
    }

    return urlPayload;
}

async function handleRequest(req: NextRequest) {
    const { tx, userId: providedUserId } = await extractPayload(req);
    const userId = providedUserId || fallbackUserId;

    if (!tx || !/^0x[a-fA-F0-9]{64}$/.test(tx)) {
        return NextResponse.json({ ok: false, error: "invalid_tx_hash" }, { status: 400 });
    }

    if (!tenantId || !supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ ok: false, error: "config_missing" }, { status: 500 });
    }

    if (!userId) {
        return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
    }

    try {
        const receipt = await publicClient.getTransactionReceipt({
            hash: tx as `0x${string}`,
        });

        if (receipt.status !== "success") {
            return NextResponse.json({ ok: false, error: "tx_reverted" }, { status: 400 });
        }

        if (!treasuryTarget) {
            return NextResponse.json({ ok: false, error: "treasury_not_configured" }, { status: 500 });
        }

        if (!receipt.to || receipt.to.toLowerCase() !== treasuryTarget) {
            return NextResponse.json({ ok: false, error: "unexpected_recipient" }, { status: 400 });
        }

        const logs = parseEventLogs({
            abi: TREASURY_ABI,
            logs: receipt.logs,
            eventName: "UserDeposit",
        });

        if (!logs.length) {
            return NextResponse.json({ ok: false, error: "user_deposit_missing" }, { status: 400 });
        }

        const depositLog = logs[0];
        const netAmount = depositLog.args?.netAmount as bigint | undefined;

        if (!netAmount || netAmount <= 0n) {
            return NextResponse.json({ ok: false, error: "invalid_net_amount" }, { status: 400 });
        }

        const credits = Math.floor((Number(netAmount) / 1_000_000) * 100);
        if (!Number.isFinite(credits) || credits <= 0) {
            return NextResponse.json({ ok: false, error: "invalid_credit_amount" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const baseRef = `treasury_topup_${tx}`;
        const metadata = {
            tx_hash: tx,
            tx_block_hash: receipt.blockHash,
            tx_block_number: Number(receipt.blockNumber),
            tx_index: receipt.transactionIndex,
            chain_id: selectedChain.id,
            ref_base: baseRef,
        };

        const creditResult = await applyCreditMutation({
            supabase,
            tenantId,
            userId,
            credits,
            refBase: baseRef,
            metadata,
            allowRefSuffix: isLocal,
        });

        if (creditResult.status === "duplicate") {
            return NextResponse.json(
                { ok: true, credits: 0, duplicate: true, ref: creditResult.ref },
                { status: 200 }
            );
        }

        if (creditResult.status === "error") {
            return NextResponse.json({ ok: false, error: "credits_update_failed" }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            credits,
            ref: creditResult.ref,
            duplicate_bypassed: creditResult.bypassedDuplicate || undefined,
        });
    } catch (error) {
        console.error("topup/credit error", error);
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: "unexpected_error", message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    return handleRequest(req);
}

export async function POST(req: NextRequest) {
    return handleRequest(req);
}

type CreditMutationResult =
    | { status: "ok"; ref: string; bypassedDuplicate: boolean }
    | { status: "duplicate"; ref: string }
    | { status: "error" };

interface CreditMutationInput {
    supabase: ReturnType<typeof createClient>;
    tenantId: string;
    userId: string;
    credits: number;
    refBase: string;
    metadata: Record<string, unknown>;
    allowRefSuffix: boolean;
}

async function applyCreditMutation({
    supabase,
    tenantId,
    userId,
    credits,
    refBase,
    metadata,
    allowRefSuffix,
}: CreditMutationInput): Promise<CreditMutationResult> {
    const attempt = await supabase.rpc("increment_balance", {
        p_tenant: tenantId,
        p_user: userId,
        p_amount: credits,
        p_kind: "credit",
        p_ref: refBase,
        p_metadata: metadata,
    });

    if (!attempt.error) {
        return { status: "ok", ref: refBase, bypassedDuplicate: false };
    }

    const message = attempt.error.message ?? "";
    const isDuplicate = attempt.error.code === "P0001" && message.includes("ref already used");

    if (!isDuplicate) {
        console.error("increment_balance failed", attempt.error);
        return { status: "error" };
    }

    if (!allowRefSuffix) {
        return { status: "duplicate", ref: refBase };
    }

    const refWithSuffix = `${refBase}_${Date.now()}`;
    const retry = await supabase.rpc("increment_balance", {
        p_tenant: tenantId,
        p_user: userId,
        p_amount: credits,
        p_kind: "credit",
        p_ref: refWithSuffix,
        p_metadata: {
            ...metadata,
            ref_base: refBase,
            ref_suffix: refWithSuffix.slice(refBase.length + 1),
            duplicate_bypass: true,
        },
    });

    if (retry.error) {
        console.error("increment_balance retry failed", retry.error);
        return { status: "error" };
    }

    console.warn(
        `[topup/credit] Duplicate ref ${refBase} detected; appended suffix for local chain (${refWithSuffix})`
    );
    return { status: "ok", ref: refWithSuffix, bypassedDuplicate: true };
}
