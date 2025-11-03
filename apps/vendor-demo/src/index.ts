import express, {
    Request,
    Response as ExpressResponse,
    NextFunction,
} from "express";
import crypto from "node:crypto";
import "dotenv/config";

const app = express();
app.use(express.json());

// 👇 Flow402 Gateway (your Next.js API)
const GATEWAY_DEDUCT_URL =
    process.env.GATEWAY_DEDUCT_URL || "http://localhost:3000/api/gateway/deduct";

/**
 * Helper: create a stable daily idempotency key per user + route
 */
function buildRef(userId: string, path: string): string {
    const day = new Date().toISOString().slice(0, 10);
    return crypto
        .createHash("sha256")
        .update(`${userId}|${path}|${day}`)
        .digest("hex")
        .slice(0, 32);
}

/**
 * Middleware that checks credits and performs deduction
 */
function x402(price_cents: number) {
    return async (req: Request, res: ExpressResponse, next: NextFunction) => {
        const debugFlag =
            typeof req.headers["x-debug"] === "string" &&
            ["1", "true", "yes", "on"].includes(req.headers["x-debug"].toLowerCase());
        const debugLogs: string[] = [];
        const pushDebug = (message: string) => {
            if (debugFlag) {
                debugLogs.push(message);
            }
        };
        const log = (message: string) => {
            console.log(message);
            pushDebug(message);
        };
        const warn = (message: string) => {
            console.warn(message);
            pushDebug(message);
        };
        const error = (message: string, detail?: unknown) => {
            console.error(message, detail);
            if (debugFlag) {
                let detailText = "";
                if (detail instanceof Error) {
                    detailText = detail.message;
                } else if (typeof detail === "string") {
                    detailText = detail;
                } else if (detail !== undefined) {
                    try {
                        detailText = JSON.stringify(detail);
                    } catch {
                        detailText = String(detail);
                    }
                }
                pushDebug(detailText ? `${message} ${detailText}` : message);
            }
        };
        const attachDebug = (payload: unknown) => {
            if (!debugFlag) return payload;
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                return { ...(payload as Record<string, unknown>), debug: debugLogs };
            }
            return { data: payload, debug: debugLogs };
        };

        const userId = (req.headers["x-user-id"] as string) || "";
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
        } else if (res.locals?.debugLogs) {
            delete res.locals.debugLogs;
        }

        const fetchFn = globalThis.fetch;
        if (!fetchFn) {
            throw new Error("Fetch API unavailable. Please run on Node 18+.");
        }

        let r: Response;
        try {
            r = await fetchFn(GATEWAY_DEDUCT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, ref, amount_cents: price_cents }),
            });
        } catch (err) {
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
            let json: any = {};
            try {
                json = await r.json();
            } catch {
                warn("⚠️ No JSON body in 402 response");
            }
            log("💰 Payment required (402)");
            return res.status(402).json(attachDebug(json));
        }

        // ❌ Unexpected response
        let body: any = {};
        try {
            body = await r.json();
        } catch {
            body = { raw: await r.text() };
        }
        error("❌ Unexpected gateway response:", { status: r.status, body });
        return res.status(500).json(
            attachDebug({
                error: "gateway internal error",
                detail: body,
            })
        );
    };
}

// Example paid endpoint
app.get("/demo/screenshot", x402(5), (_req, res) => {
    const debugLogs = res.locals?.debugLogs as string[] | undefined;
    const payload: Record<string, unknown> = { ok: true, bytes: 12345 };
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
