"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_crypto_1 = __importDefault(require("node:crypto"));
require("dotenv/config");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// 👇 Flow402 Gateway (your Next.js API)
const GATEWAY_DEDUCT_URL = process.env.GATEWAY_DEDUCT_URL || "http://localhost:3000/api/gateway/deduct";
const FLOW402_VENDOR_KEY = requireEnv("FLOW402_VENDOR_KEY");
const FLOW402_SIGNING_SECRET = requireEnv("FLOW402_SIGNING_SECRET");
/**
 * Helper: create a unique idempotency key per call.
 * Real vendors should supply a request-scoped UUID so retries remain safe.
 * We include the date in the hash so keys stay debuggable in Supabase.
 */
function buildRef(userId, path) {
    const day = new Date().toISOString().slice(0, 10);
    const nonce = node_crypto_1.default.randomBytes(6).toString("hex");
    return node_crypto_1.default
        .createHash("sha256")
        .update(`${userId}|${path}|${day}|${nonce}`)
        .digest("hex")
        .slice(0, 32);
}
/**
 * Middleware that checks credits and performs deduction
 */
function x402(priceCredits) {
    return async (req, res, next) => {
        const debugFlag = typeof req.headers["x-debug"] === "string" &&
            ["1", "true", "yes", "on"].includes(req.headers["x-debug"].toLowerCase());
        const debugLogs = [];
        const pushDebug = (message) => {
            if (debugFlag) {
                debugLogs.push(message);
            }
        };
        const log = (message) => {
            console.log(message);
            pushDebug(message);
        };
        const warn = (message) => {
            console.warn(message);
            pushDebug(message);
        };
        const error = (message, detail) => {
            console.error(message, detail);
            if (debugFlag) {
                let detailText = "";
                if (detail instanceof Error) {
                    detailText = detail.message;
                }
                else if (typeof detail === "string") {
                    detailText = detail;
                }
                else if (detail !== undefined) {
                    try {
                        detailText = JSON.stringify(detail);
                    }
                    catch {
                        detailText = String(detail);
                    }
                }
                pushDebug(detailText ? `${message} ${detailText}` : message);
            }
        };
        const attachDebug = (payload) => {
            if (!debugFlag)
                return payload;
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                return { ...payload, debug: debugLogs };
            }
            return { data: payload, debug: debugLogs };
        };
        const userId = req.headers["x-user-id"] || "";
        if (!userId) {
            pushDebug("x-user-id header missing");
            return res
                .status(400)
                .json(attachDebug({ error: "x-user-id header required" }));
        }
        const ref = buildRef(userId, req.path);
        log(`➡️ Checking credit for ${userId} @ ${ref}`);
        if (debugFlag) {
            res.locals.debugLogs = debugLogs;
        }
        else if (res.locals?.debugLogs) {
            delete res.locals.debugLogs;
        }
        const fetchFn = globalThis.fetch;
        if (!fetchFn) {
            throw new Error("Fetch API unavailable. Please run on Node 18+.");
        }
        let r;
        try {
            const gatewayBody = JSON.stringify({
                userId,
                ref,
                amount_credits: priceCredits,
            });
            r = await fetchFn(GATEWAY_DEDUCT_URL, {
                method: "POST",
                headers: buildSignatureHeaders(gatewayBody),
                body: gatewayBody,
            });
        }
        catch (err) {
            error("❌ Gateway unreachable:", err);
            return res
                .status(500)
                .json(attachDebug({ error: "gateway unreachable" }));
        }
        // ✅ Successful charge
        if (r.status === 200) {
            log("✅ Payment accepted");
            return next();
        }
        // 💰 402 Payment Required
        if (r.status === 402) {
            let json = {};
            try {
                json = await r.json();
            }
            catch {
                warn("⚠️ No JSON body in 402 response");
            }
            log("💰 Payment required (402)");
            return res.status(402).json(attachDebug(json));
        }
        // ❌ Unexpected response
        let body = {};
        try {
            body = await r.json();
        }
        catch {
            body = { raw: await r.text() };
        }
        error("❌ Unexpected gateway response:", { status: r.status, body });
        return res.status(500).json(attachDebug({
            error: "gateway internal error",
            detail: body,
        }));
    };
}
// Example paid endpoint
app.get("/demo/screenshot", x402(5), (_req, res) => {
    const debugLogs = res.locals?.debugLogs;
    const payload = { ok: true, bytes: 12345 };
    if (debugLogs && debugLogs.length > 0) {
        payload.debug = debugLogs;
    }
    res.json(payload);
});
// Basic health check
app.get("/", (_req, res) => {
    res.json({ message: "Flow402 vendor demo backend running ✅" });
});
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Vendor demo running on :${port}`));
function buildSignatureHeaders(body) {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyHash = node_crypto_1.default.createHash("sha256").update(body, "utf8").digest("hex");
    const signature = node_crypto_1.default
        .createHmac("sha256", FLOW402_SIGNING_SECRET)
        .update(`${timestamp}.${body}`, "utf8")
        .digest("hex");
    return {
        "Content-Type": "application/json",
        "x-f402-key": FLOW402_VENDOR_KEY,
        "x-f402-body-sha": bodyHash,
        "x-f402-sig": `t=${timestamp},v1=${signature}`,
    };
}
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} env var is required for signed gateway calls`);
    }
    return value;
}
