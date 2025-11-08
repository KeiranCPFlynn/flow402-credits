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
/**
 * Helper: create a stable daily idempotency key per user + route
 */
function buildRef(userId, path) {
    const day = new Date().toISOString().slice(0, 10);
    return node_crypto_1.default
        .createHash("sha256")
        .update(`${userId}|${path}|${day}`)
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
            r = await fetchFn(GATEWAY_DEDUCT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    ref,
                    amount_credits: priceCredits,
                }),
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
