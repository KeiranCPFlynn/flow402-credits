#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";

const FLOW402_GATEWAY = process.env.FLOW402_GATEWAY || "http://localhost:3000/api/gateway/deduct";
const FLOW402_TOPUP = process.env.FLOW402_TOPUP || "http://localhost:3000/api/topup/mock";
const FLOW402_VENDOR_KEY = process.env.FLOW402_VENDOR_KEY || "demo";
const FLOW402_SIGNING_SECRET = process.env.FLOW402_SIGNING_SECRET;
const FLOW402_USER_ID =
    process.env.FLOW402_USER_ID || "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

if (!FLOW402_SIGNING_SECRET) {
    console.error("FLOW402_SIGNING_SECRET must be set before running this script.");
    process.exit(1);
}

function signGatewayBody(body) {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodySha = crypto.createHash("sha256").update(body, "utf8").digest("hex");
    const digest = crypto
        .createHmac("sha256", FLOW402_SIGNING_SECRET)
        .update(`${timestamp}.${body}`, "utf8")
        .digest("hex");
    return {
        bodySha,
        header: `t=${timestamp},v1=${digest}`,
    };
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = text;
    }
    return { response, json };
}

function buildDeductBody(ref, amount) {
    return {
        userId: FLOW402_USER_ID,
        ref,
        amount_credits: amount,
    };
}

async function callGateway(bodyObj, idempotencyKey) {
    const body = JSON.stringify(bodyObj);
    const { bodySha, header } = signGatewayBody(body);
    return fetchJson(FLOW402_GATEWAY, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-f402-key": FLOW402_VENDOR_KEY,
            "x-f402-body-sha": bodySha,
            "x-f402-sig": header,
            "Idempotency-Key": idempotencyKey,
        },
        body,
    });
}

async function callTopup(amount, idempotencyKey, userId = FLOW402_USER_ID) {
    const body = JSON.stringify({
        userId,
        amount_credits: amount,
    });
    return fetchJson(FLOW402_TOPUP, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
        },
        body,
    });
}

function assertDeepEqual(actual, expected, context) {
    assert.deepStrictEqual(actual, expected, `${context}: payload mismatch`);
}

async function testGatewayIdempotency() {
    const ref = `cli_ref_${Date.now()}`;
    const idempotencyKey = ref;
    const initial = await callGateway(buildDeductBody(ref, 5), idempotencyKey);
    const { response: firstRes, json: firstBody } = initial;
    console.log("Gateway primary:", firstRes.status, firstBody);
    assert([200, 402].includes(firstRes.status), "gateway: unexpected status");

    const replay = await callGateway(buildDeductBody(ref, 5), idempotencyKey);
    console.log("Gateway replay:", replay.response.status, replay.json);
    assert.strictEqual(
        replay.response.status,
        firstRes.status,
        "gateway replay: status mismatch"
    );
    assertDeepEqual(replay.json, firstBody, "gateway replay");

    const conflict = await callGateway(buildDeductBody(`${ref}_diff`, 50), idempotencyKey);
    console.log("Gateway conflict:", conflict.response.status, conflict.json);
    assert.strictEqual(conflict.response.status, 409, "gateway conflict status");
    assert.strictEqual(
        conflict.json.error,
        "idempotency_conflict",
        "gateway conflict error code"
    );
}

async function testTopupIdempotency() {
    const idem = crypto.randomUUID();
    const first = await callTopup(500, idem);
    console.log("Topup primary:", first.response.status, first.json);
    assert.strictEqual(first.response.status, 200, "topup primary status");
    assertDeepEqual(first.json, { ok: true }, "topup primary body");

    const replay = await callTopup(500, idem);
    console.log("Topup replay:", replay.response.status, replay.json);
    assert.strictEqual(replay.response.status, 200, "topup replay status");
    assertDeepEqual(replay.json, first.json, "topup replay body");

    const conflict = await callTopup(999, idem);
    console.log("Topup conflict:", conflict.response.status, conflict.json);
    assert.strictEqual(conflict.response.status, 409, "topup conflict status");
    assert.strictEqual(conflict.json.error, "idempotency_conflict", "topup conflict error");
}

async function main() {
    await testGatewayIdempotency();
    await testTopupIdempotency();
    console.log("✅ Idempotency tests passed");
}

main().catch((error) => {
    console.error("❌ Idempotency tests failed");
    console.error(error);
    process.exit(1);
});
