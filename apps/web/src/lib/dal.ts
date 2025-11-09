import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Flow402Error, Flow402ErrorCode } from "./flow402-error";

type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const vendorRowSchema = z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    api_key: z.string().min(8),
    signing_secret: z.string().min(16),
});

const ethAddressSchema = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => value.toLowerCase());

const vendorUserSchema = z.object({
    vendor_id: z.string().uuid(),
    user_id: z.string().uuid(),
    user_external_id: z.string().min(1),
    eth_address: ethAddressSchema.nullable().optional(),
});

const creditRowSchema = z.object({
    tenant_id: z.string().uuid(),
    user_id: z.string().uuid(),
    balance_cents: z.number().int(),
    currency: z.string().min(1),
});

const userSettingsRowSchema = z.object({
    vendor_id: z.string().uuid(),
    user_id: z.string().uuid(),
    settings: z.record(z.string(), z.unknown()),
});

const apiKeySchema = z.string().min(4);
const uuidSchema = z.string().uuid();
const settingsInputSchema = z.record(z.string(), z.unknown()).default({});
const metadataSchema = z.record(z.string(), z.unknown()).default({});

export type VendorRecord = z.infer<typeof vendorRowSchema>;
export type VendorUserRecord = z.infer<typeof vendorUserSchema>;

export interface BalanceSnapshot {
    credits: number;
    currency: string;
}

export type BalanceMutationKind = "debit" | "credit" | "fee";

export interface BalanceMutationInput {
    vendorId: string;
    vendorUserId: string;
    deltaCredits: number;
    kind: BalanceMutationKind;
    ref?: string;
    route?: string;
    meta?: Record<string, unknown>;
}

export interface UpsertSettingsInput {
    vendorId: string;
    vendorUserId: string;
    patch: Record<string, unknown>;
}

type Maybe<T> = T | null;

export class Flow402Dal {
    constructor(private readonly supabase: AnySupabaseClient) {}

    async getVendorByKey(apiKey: string): Promise<VendorRecord> {
        const parsedKey = parseOrThrow(
            apiKeySchema,
            apiKey.trim(),
            "validation_error",
            "Invalid API key value"
        );
        const candidates: Array<["api_key" | "slug" | "id", string]> = [
            ["api_key", parsedKey],
            ["slug", parsedKey],
        ];

        if (uuidSchema.safeParse(parsedKey).success) {
            candidates.push(["id", parsedKey]);
        }

        for (const [column, value] of candidates) {
            const vendor = await this.fetchVendor(column, value);
            if (vendor) {
                return vendor;
            }
        }

        throw new Flow402Error(
            "vendor_not_found",
            `No vendor found for key "${parsedKey}"`,
            { status: 404 }
        );
    }

    async ensureVendorUser(
        vendorId: string,
        userExternalId: string,
        userEth?: string
    ): Promise<VendorUserRecord> {
        const parsedVendorId = parseOrThrow(
            uuidSchema,
            vendorId,
            "validation_error",
            "Invalid vendor identifier"
        );
        const parsedUserId = parseOrThrow(
            uuidSchema,
            userExternalId,
            "validation_error",
            "Invalid vendor user identifier"
        );
        const normalizedEth = userEth
            ? parseOrThrow(ethAddressSchema, userEth, "validation_error", "Invalid Ethereum address")
            : undefined;

        const existing = await this.fetchVendorUser(parsedVendorId, parsedUserId);
        if (existing) {
            if (normalizedEth && normalizedEth !== existing.eth_address) {
                return this.updateVendorUserEth(parsedVendorId, parsedUserId, normalizedEth);
            }

            return existing;
        }

        const insertPayload = {
            vendor_id: parsedVendorId,
            user_id: parsedUserId,
            user_external_id: parsedUserId,
            eth_address: normalizedEth ?? null,
        };

        const { data, error } = await this.supabase
            .from("vendor_users")
            .insert(insertPayload)
            .select("*")
            .single();

        if (error) {
            if (error.code === "23505") {
                const retry = await this.fetchVendorUser(parsedVendorId, parsedUserId);
                if (retry) {
                    return retry;
                }
            }

            throw new Flow402Error("vendor_user_conflict", "Unable to create vendor user", {
                cause: error,
            });
        }

        return parseOrThrow(
            vendorUserSchema,
            data,
            "vendor_user_lookup_failed",
            "Invalid vendor user payload received"
        );
    }

    async getBalance(vendorId: string, vendorUserId: string): Promise<BalanceSnapshot> {
        const parsedVendor = parseOrThrow(
            uuidSchema,
            vendorId,
            "validation_error",
            "Invalid vendor identifier"
        );
        const parsedUser = parseOrThrow(
            uuidSchema,
            vendorUserId,
            "validation_error",
            "Invalid vendor user identifier"
        );

        const { data, error } = await this.supabase
            .from("credits")
            .select("tenant_id, user_id, balance_cents, currency")
            .eq("tenant_id", parsedVendor)
            .eq("user_id", parsedUser)
            .maybeSingle();

        if (error) {
            throw new Flow402Error("balance_lookup_failed", "Unable to fetch balance", {
                cause: error,
            });
        }

        if (!data) {
            return { credits: 0, currency: "USDC" };
        }

        const parsed = parseOrThrow(
            creditRowSchema,
            data,
            "balance_lookup_failed",
            "Invalid balance payload received"
        );
        return {
            credits: parsed.balance_cents,
            currency: parsed.currency,
        };
    }

    async incrementBalance(input: BalanceMutationInput): Promise<number> {
        const mutation = parseOrThrow(
            balanceMutationInputSchema,
            input,
            "validation_error",
            "Invalid balance mutation payload"
        );
        enforceBalanceGuards(mutation);
        const metadata = buildMetadata(mutation);
        const amount = Math.abs(mutation.deltaCredits);

        if (mutation.kind === "credit") {
            return this.callIncrementBalanceRpc(mutation, amount, metadata);
        }

        return this.callDeductBalanceRpc(mutation, amount, metadata);
    }

    async getUserSettings(
        vendorId: string,
        vendorUserId: string
    ): Promise<Record<string, unknown>> {
        const parsedVendor = parseOrThrow(
            uuidSchema,
            vendorId,
            "validation_error",
            "Invalid vendor identifier"
        );
        const parsedUser = parseOrThrow(
            uuidSchema,
            vendorUserId,
            "validation_error",
            "Invalid vendor user identifier"
        );

        const { data, error } = await this.supabase
            .from("vendor_user_settings")
            .select("vendor_id, user_id, settings")
            .eq("vendor_id", parsedVendor)
            .eq("user_id", parsedUser)
            .maybeSingle();

        if (error) {
            throw new Flow402Error("settings_lookup_failed", "Unable to load user settings", {
                cause: error,
            });
        }

        if (!data) {
            return {};
        }

        const parsed = parseOrThrow(
            userSettingsRowSchema,
            data,
            "settings_lookup_failed",
            "Invalid settings payload received"
        );
        return parsed.settings as Record<string, unknown>;
    }

    async upsertUserSettings(input: UpsertSettingsInput): Promise<Record<string, unknown>> {
        const parsed = parseOrThrow(
            upsertSettingsInputSchema,
            input,
            "validation_error",
            "Invalid settings payload"
        );
        const current = await this.getUserSettings(parsed.vendorId, parsed.vendorUserId);
        const merged = { ...current, ...parsed.patch };

        const { data, error } = await this.supabase
            .from("vendor_user_settings")
            .upsert({
                vendor_id: parsed.vendorId,
                user_id: parsed.vendorUserId,
                settings: merged,
            })
            .select("vendor_id, user_id, settings")
            .single();

        if (error) {
            throw new Flow402Error("settings_upsert_failed", "Unable to persist user settings", {
                cause: error,
            });
        }

        const parsedRow = parseOrThrow(
            userSettingsRowSchema,
            data,
            "settings_upsert_failed",
            "Invalid persisted settings payload"
        );
        return parsedRow.settings as Record<string, unknown>;
    }

    private async fetchVendor(
        column: "api_key" | "slug" | "id",
        value: string
    ): Promise<Maybe<VendorRecord>> {
        const { data, error } = await this.supabase
            .from("tenants")
            .select("id, slug, name, api_key, signing_secret")
            .eq(column, value)
            .maybeSingle();

        if (error) {
            throw new Flow402Error("vendor_lookup_failed", "Unable to query vendor", { cause: error });
        }

        return data
            ? parseOrThrow(
                  vendorRowSchema,
                  data,
                  "vendor_lookup_failed",
                  "Invalid vendor payload received"
              )
            : null;
    }

    private async fetchVendorUser(
        vendorId: string,
        userId: string
    ): Promise<Maybe<VendorUserRecord>> {
        const { data, error } = await this.supabase
            .from("vendor_users")
            .select("vendor_id, user_id, user_external_id, eth_address")
            .eq("vendor_id", vendorId)
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            throw new Flow402Error("vendor_user_lookup_failed", "Unable to query vendor user", {
                cause: error,
            });
        }

        return data
            ? parseOrThrow(
                  vendorUserSchema,
                  data,
                  "vendor_user_lookup_failed",
                  "Invalid vendor user payload received"
              )
            : null;
    }

    private async updateVendorUserEth(
        vendorId: string,
        userId: string,
        eth: string
    ): Promise<VendorUserRecord> {
        const { data, error } = await this.supabase
            .from("vendor_users")
            .update({ eth_address: eth })
            .eq("vendor_id", vendorId)
            .eq("user_id", userId)
            .select("vendor_id, user_id, user_external_id, eth_address")
            .single();

        if (error) {
            throw new Flow402Error("vendor_user_lookup_failed", "Unable to update vendor user", {
                cause: error,
            });
        }

        return parseOrThrow(
            vendorUserSchema,
            data,
            "vendor_user_lookup_failed",
            "Invalid vendor user payload received"
        );
    }

    private async callIncrementBalanceRpc(
        mutation: BalanceMutationInput,
        amount: number,
        metadata: Record<string, unknown>
    ): Promise<number> {
        const { data, error } = await this.supabase.rpc("increment_balance", {
            p_tenant: mutation.vendorId,
            p_user: mutation.vendorUserId,
            p_amount: amount,
            p_kind: "topup",
            p_ref: mutation.ref ?? null,
            p_metadata: metadata,
        });

        if (error) {
            throw new Flow402Error("mutation_failed", "increment_balance RPC failed", {
                cause: error,
            });
        }

        return normalizeBalanceResult(data);
    }

    private async callDeductBalanceRpc(
        mutation: BalanceMutationInput,
        amount: number,
        metadata: Record<string, unknown>
    ): Promise<number> {
        const { data, error } = await this.supabase.rpc("deduct_balance", {
            p_tenant: mutation.vendorId,
            p_user: mutation.vendorUserId,
            p_amount: amount,
            p_ref: mutation.ref!,
            p_metadata: metadata,
        });

        if (error) {
            const message = error.message ?? "";
            if (message.includes("insufficient_funds")) {
                throw new Flow402Error("insufficient_funds", "Insufficient credits for mutation", {
                    status: 402,
                    cause: error,
                });
            }

            throw new Flow402Error("mutation_failed", "deduct_balance RPC failed", {
                cause: error,
            });
        }

        return normalizeBalanceResult(data);
    }
}

const balanceMutationInputSchema = z.object({
    vendorId: uuidSchema,
    vendorUserId: uuidSchema,
    deltaCredits: z.number().int(),
    kind: z.enum(["debit", "credit", "fee"]),
    ref: z.string().min(4).optional(),
    route: z.string().min(1).optional(),
    meta: metadataSchema.optional(),
});

const upsertSettingsInputSchema = z.object({
    vendorId: uuidSchema,
    vendorUserId: uuidSchema,
    patch: settingsInputSchema,
});

function parseOrThrow<T>(
    schema: z.ZodType<T>,
    value: unknown,
    code: Flow402ErrorCode,
    message: string
): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new Flow402Error(code, message, { cause: result.error });
    }
    return result.data;
}

function enforceBalanceGuards(input: BalanceMutationInput) {
    if (input.kind === "credit" && input.deltaCredits <= 0) {
        throw new Flow402Error(
            "mutation_guard_failed",
            "Credit operations must receive a positive delta"
        );
    }

    if (input.kind !== "credit" && input.deltaCredits >= 0) {
        throw new Flow402Error(
            "mutation_guard_failed",
            "Debit/Fee operations must receive a negative delta"
        );
    }

    if (input.kind !== "credit" && !input.ref) {
        throw new Flow402Error(
            "mutation_guard_failed",
            "Debit and fee mutations require an idempotent ref value"
        );
    }
}

function buildMetadata(input: BalanceMutationInput): Record<string, unknown> {
    const baseMeta: Record<string, unknown> = {
        mutation_kind: input.kind,
    };

    if (input.route) {
        baseMeta.route = input.route;
    }

    if (input.ref) {
        baseMeta.ref = input.ref;
    }

    if (input.meta) {
        for (const [key, value] of Object.entries(input.meta)) {
            if (value !== undefined) {
                baseMeta[key] = value;
            }
        }
    }

    return baseMeta;
}

function normalizeBalanceResult(value: unknown): number {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return Number(value);
    }

    throw new Flow402Error("mutation_failed", "RPC returned an invalid balance value", {
        details: value,
    });
}
