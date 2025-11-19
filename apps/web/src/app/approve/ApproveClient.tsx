"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { approveUSDC, checkAllowance, depositFor } from "@/lib/treasury-actions";
import { VENDOR_ADDRESS } from "@/lib/treasury";

type ApproveClientProps = {
    amount: string;
    spendingLimit: string;
    userId: string | null;
};

const USDC_SCALE = 1_000_000n;

const parseUsdAmount = (raw: string) => {
    const normalized = raw.trim();
    if (!normalized || !/^\d+(?:\.\d{0,6})?$/.test(normalized)) {
        return null;
    }

    const [whole, fraction = ""] = normalized.split(".");
    const padded = (fraction + "000000").slice(0, 6);

    try {
        return BigInt(whole + padded);
    } catch {
        return null;
    }
};

const formatUsd = (value: bigint) => {
    const decimal = Number(value) / 1_000_000;
    return decimal.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    });
};

export default function ApproveClient({ amount, spendingLimit, userId }: ApproveClientProps) {
    const amountUSDC = useMemo(() => parseUsdAmount(amount), [amount]);
    const spendingLimitUSDC = useMemo(() => parseUsdAmount(spendingLimit), [spendingLimit]);

    const router = useRouter();
    const { address, isConnected } = useAccount();
    const { connect, connectors, status: connectStatus } = useConnect();

    const [allowance, setAllowance] = useState<bigint | null>(null);
    const [checkingAllowance, setCheckingAllowance] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [approvePending, setApprovePending] = useState(false);
    const [depositPending, setDepositPending] = useState(false);

    const estimatedCredits = useMemo(() => {
        if (amountUSDC === null) return null;
        return Math.floor((Number(amountUSDC) / 1_000_000) * 100);
    }, [amountUSDC]);

    const allowanceSatisfied =
        allowance !== null && amountUSDC !== null ? allowance >= amountUSDC : false;

    const refreshAllowance = useCallback(async () => {
        if (!address || !isConnected) {
            setAllowance(null);
            return;
        }

        setCheckingAllowance(true);
        setActionError(null);
        try {
            const value = await checkAllowance(address);
            setAllowance(value);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(`Failed to load allowance: ${message}`);
        } finally {
            setCheckingAllowance(false);
        }
    }, [address, isConnected]);

    useEffect(() => {
        if (!address || !isConnected) return;
        refreshAllowance();
    }, [address, isConnected, refreshAllowance]);

    const handleConnect = async () => {
        if (!connectors.length) {
            setActionError("No wallet connectors available");
            return;
        }

        try {
            await connect({ connector: connectors[0] });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(`Wallet connection failed: ${message}`);
        }
    };

    const handleApprove = async () => {
        if (amountUSDC === null || amountUSDC <= 0n) return;
        setApprovePending(true);
        setActionError(null);
        try {
            await approveUSDC(amountUSDC);
            await refreshAllowance();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(`Approval failed: ${message}`);
        } finally {
            setApprovePending(false);
        }
    };

    const handleDeposit = async () => {
        if (amountUSDC === null || spendingLimitUSDC === null) return;
        setDepositPending(true);
        setActionError(null);
        try {
            console.log(
                "[Approve] Depositing",
                amountUSDC.toString(),
                "USDC units with spending limit",
                spendingLimitUSDC.toString()
            );
            const hash = await depositFor(VENDOR_ADDRESS as `0x${string}`, amountUSDC, spendingLimitUSDC);
            console.log("[Approve] Deposit transaction hash:", hash);
            const search = new URLSearchParams({ tx: hash });
            if (userId) {
                search.set("userId", userId);
            }
            console.log("[Approve] Redirecting to /api/topup/credit with hash:", hash);
            router.push(`/api/topup/credit?${search.toString()}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(`Deposit failed: ${message}`);
            console.error("[Approve] Deposit error:", error);
        } finally {
            setDepositPending(false);
        }
    };

    const invalidAmount = amountUSDC === null || amountUSDC <= 0n;
    const invalidSpending = spendingLimitUSDC === null || spendingLimitUSDC <= 0n;

    return (
        <main className="min-h-screen bg-gray-50 text-gray-900">
            <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
                <header className="space-y-1">
                    <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                        Flow402 Credits
                    </p>
                    <h1 className="text-3xl font-semibold text-gray-900">Top Up Credits</h1>
                    <p className="text-sm text-gray-600">
                        Approve USDC spending and deposit into the Flow402 Treasury to mint platform credits.
                    </p>
                </header>

                <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <dl className="space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-gray-500">Amount (USDC)</dt>
                            <dd className="font-semibold text-gray-900">
                                {amountUSDC !== null ? formatUsd(amountUSDC) : "Invalid"}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-gray-500">Spending limit (USDC)</dt>
                            <dd className="font-semibold text-gray-900">
                                {spendingLimitUSDC !== null ? formatUsd(spendingLimitUSDC) : "Invalid"}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-gray-500">Estimated credits</dt>
                            <dd className="font-semibold text-gray-900">
                                {estimatedCredits !== null ? estimatedCredits.toLocaleString() : "—"}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-gray-500">Wallet</dt>
                            <dd className="font-mono text-xs text-gray-800">
                                {address ?? "Not connected"}
                            </dd>
                        </div>
                    </dl>
                </section>

                {actionError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        {actionError}
                    </div>
                )}

                {!isConnected ? (
                    <button
                        type="button"
                        className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        onClick={handleConnect}
                        disabled={connectStatus === "pending"}
                    >
                        {connectStatus === "pending" ? "Connecting..." : "Connect Wallet"}
                    </button>
                ) : (
                    <div className="space-y-4">
                        <button
                            type="button"
                            className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                            onClick={handleApprove}
                            disabled={
                                invalidAmount ||
                                invalidSpending ||
                                checkingAllowance ||
                                approvePending ||
                                allowanceSatisfied
                            }
                        >
                            {approvePending ? "Approving..." : "Approve USDC"}
                        </button>

                        <button
                            type="button"
                            className="w-full rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white shadow hover:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:cursor-not-allowed disabled:bg-gray-400"
                            onClick={handleDeposit}
                            disabled={
                                invalidAmount ||
                                invalidSpending ||
                                !allowanceSatisfied ||
                                depositPending
                            }
                        >
                            {depositPending ? "Depositing..." : "Deposit Credits"}
                        </button>

                        <p className="text-xs text-gray-500">
                            Allowance status:{" "}
                            {checkingAllowance
                                ? "Checking..."
                                : allowance !== null && amountUSDC !== null
                                ? `${allowance.toString()} / ${amountUSDC.toString()}`
                                : "Not available"}
                        </p>
                    </div>
                )}

                {(invalidAmount || invalidSpending) && (
                    <p className="text-xs text-red-600">
                        {invalidAmount && "Missing or invalid amount. "}
                        {invalidSpending && "Missing or invalid spending limit."}
                    </p>
                )}
            </div>
        </main>
    );
}
