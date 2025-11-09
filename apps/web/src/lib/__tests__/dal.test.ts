import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SupabaseClient } from "@supabase/supabase-js";
import { Flow402Dal } from "../dal";
import { Flow402Error } from "../flow402-error";

const vendorId = "0b7d4b0a-6e10-4db4-8571-2c74e07bcb35";
const userId = "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

describe("Flow402Dal", () => {
    it("guards against negative credit deltas", async () => {
        const rpcCalls: Array<Parameters<SupabaseClient<unknown>["rpc"]>> = [];
        const supabase = createSupabaseStub({
            rpc: async (...args) => {
                rpcCalls.push(args);
                return { data: null, error: null };
            },
        });

        const dal = new Flow402Dal(supabase);

        await assert.rejects(
            () =>
                dal.incrementBalance({
                    vendorId,
                    vendorUserId: userId,
                    deltaCredits: -25,
                    kind: "credit",
                }),
            (error: unknown) => {
                assert(error instanceof Flow402Error);
                assert.equal(error.code, "mutation_guard_failed");
                return true;
            }
        );

        assert.equal(rpcCalls.length, 0);
    });

    it("throws vendor_not_found after exhausting lookup columns", async () => {
        const responses = [
            { data: null, error: null },
            { data: null, error: null },
            { data: null, error: null },
        ];

        const tenantBuilder = createSelectBuilder(responses);

        const supabase = createSupabaseStub({
            from: () => tenantBuilder,
        });

        const dal = new Flow402Dal(supabase);

        await assert.rejects(
            () => dal.getVendorByKey("missing-key"),
            (error: unknown) => {
                assert(error instanceof Flow402Error);
                assert.equal(error.code, "vendor_not_found");
                return true;
            }
        );
    });

    it("creates vendor user when none exists", async () => {
        const insertPayloads: unknown[] = [];
        const vendorUsersBuilder = createVendorUsersBuilder({
            selectResponses: [{ data: null, error: null }],
            insertResponse: {
                data: {
                    vendor_id: vendorId,
                    user_id: userId,
                    user_external_id: userId,
                    eth_address: null,
                },
                error: null,
            },
            insertPayloads,
        });

        const supabase = createSupabaseStub({
            from: () => vendorUsersBuilder,
        });

        const dal = new Flow402Dal(supabase);
        const user = await dal.ensureVendorUser(vendorId, userId);

        assert.deepEqual(user, {
            vendor_id: vendorId,
            user_id: userId,
            user_external_id: userId,
            eth_address: null,
        });
        assert.equal(insertPayloads.length, 1);
    });

    it("merges existing settings during upsert", async () => {
        const existingSettings = { theme: "dark", limit: 100 };
        const mergedSettings = { ...existingSettings, limit: 200, locale: "en-US" };

        const selectBuilder = createSelectBuilder([
            {
                data: {
                    vendor_id: vendorId,
                    user_id: userId,
                    settings: existingSettings,
                },
                error: null,
            },
        ]);

        const upsertBuilder = createUpsertBuilder({
            data: {
                vendor_id: vendorId,
                user_id: userId,
                settings: mergedSettings,
            },
            error: null,
        });

        let fromCalls = 0;
        const supabase = createSupabaseStub({
            from: () => {
                fromCalls += 1;
                return fromCalls === 1 ? selectBuilder : upsertBuilder;
            },
        });

        const dal = new Flow402Dal(supabase);
        const result = await dal.upsertUserSettings({
            vendorId,
            vendorUserId: userId,
            patch: { limit: 200, locale: "en-US" },
        });

        assert.deepEqual(result, mergedSettings);
    });
});

interface SupabaseOverrides {
    from?: SupabaseClient<unknown>["from"];
    rpc?: SupabaseClient<unknown>["rpc"];
}

function createSupabaseStub(overrides: SupabaseOverrides = {}): SupabaseClient<unknown> {
    const defaultFrom: SupabaseClient<unknown>["from"] = () => {
        throw new Error("Unexpected table access");
    };

    const defaultRpc: SupabaseClient<unknown>["rpc"] = async () => ({
        data: null,
        error: null,
    });

    return {
        from: overrides.from ?? defaultFrom,
        rpc: overrides.rpc ?? defaultRpc,
    } as unknown as SupabaseClient<unknown>;
}

function createSelectBuilder(responses: Array<{ data: unknown; error: unknown }>) {
    const builder: Record<string, unknown> = {};

    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = async () => responses.shift() ?? { data: null, error: null };

    return builder;
}

interface VendorUsersBuilderConfig {
    selectResponses: Array<{ data: unknown; error: unknown }>;
    insertResponse: { data: unknown; error: unknown };
    insertPayloads: unknown[];
}

function createVendorUsersBuilder(config: VendorUsersBuilderConfig) {
    const builder: Record<string, unknown> = {};

    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = async () => config.selectResponses.shift() ?? { data: null, error: null };
    builder.insert = (payload: unknown) => {
        config.insertPayloads.push(payload);
        return {
            select: () => ({
                single: async () => config.insertResponse,
            }),
        };
    };

    return builder;
}

function createUpsertBuilder(response: { data: unknown; error: unknown }) {
    return {
        upsert: () => ({
            select: () => ({
                single: async () => response,
            }),
        }),
    };
}
