import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSig, hashBody, verify, VerifiableRequest } from "../hmac";

const body =
    '{"amount_credits":5,"ref":"demo-ref","userId":"9c0383a1-0887-4c0f-98ca-cb71ffc4e76c"}';
const secret = "demo-signing-secret";
const timestamp = 1729200000;
const expectedBodyHash = "5a159b6e835fc4d107d0ffd630fe705c1a86c00ebf7d5dad7179ad912d249129";
const expectedSig = "6f65904bd1173ac13d5a79d2c038d7db7908513bf50e41509d964ff2ac924ac5";

describe("hmac", () => {
    it("hashBody returns deterministic SHA-256 digest", () => {
        assert.equal(hashBody(body), expectedBodyHash);
    });

    it("computeSig matches the spec vector", () => {
        const { header, digest, timestamp: ts } = computeSig(secret, body, timestamp);
        assert.equal(ts, timestamp);
        assert.equal(digest, expectedSig);
        assert.equal(header, `t=${timestamp},v1=${expectedSig}`);
    });

    it("verify accepts a valid signed request", async () => {
        const req = createRequest({
            "x-f402-body-sha": expectedBodyHash,
            "x-f402-sig": `t=${timestamp},v1=${expectedSig}`,
        });

        const result = await verify(req, secret, { now: timestamp });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.body, body);
            assert.equal(result.signature, expectedSig);
            assert.equal(result.timestamp, timestamp);
        }
    });

    it("verify rejects stale signatures", async () => {
        const req = createRequest({
            "x-f402-body-sha": expectedBodyHash,
            "x-f402-sig": `t=${timestamp},v1=${expectedSig}`,
        });

        const result = await verify(req, secret, { now: timestamp + 301 });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "timestamp_out_of_window");
        }
    });
});

function createRequest(headers: Record<string, string>): VerifiableRequest {
    return {
        headers: new Headers(headers),
        text: async () => body,
    };
}
