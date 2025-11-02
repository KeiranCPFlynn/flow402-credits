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
        const userId = (req.headers["x-user-id"] as string) || "";
        if (!userId) {
            return res.status(400).json({ error: "x-user-id header required" });
        }

        const ref = buildRef(userId, req.path);
        console.log(`➡️ Checking credit for ${userId} @ ${ref}`);

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
            console.error("❌ Gateway unreachable:", err);
            return res.status(500).json({ error: "gateway unreachable" });
        }

        // ✅ Successful charge
        if (r.status === 200) {
            console.log("✅ Payment accepted");
            return next();
        }

        // 💰 402 Payment Required
        if (r.status === 402) {
            let json: any = {};
            try {
                json = await r.json();
            } catch {
                console.warn("⚠️ No JSON body in 402 response");
            }
            console.log("💰 Payment required (402)");
            return res.status(402).json(json);
        }

        // ❌ Unexpected response
        let body: any = {};
        try {
            body = await r.json();
        } catch {
            body = { raw: await r.text() };
        }
        console.error("❌ Unexpected gateway response:", r.status, body);
        return res
            .status(500)
            .json({ error: "gateway internal error", detail: body });
    };
}

// Example paid endpoint
app.get("/demo/screenshot", x402(5), (_req, res) => {
    res.json({ ok: true, bytes: 12345 });
});

// Basic health check
app.get("/", (_req, res) => {
    res.json({ message: "Flow402 vendor demo backend running ✅" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Vendor demo running on :${port}`));
