import dotenv from "dotenv";
dotenv.config({ path: "../../.env" }); // 👈 points to the root of your repo

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
// Your agent/user identity
const AGENT_USER_ID = "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

// Vendor endpoint that might respond 402
const VENDOR_URL = "http://localhost:4000/demo/screenshot";

// Flow402 gateway endpoints
const GATEWAY_TOPUP_URL = "http://localhost:3000/api/topup/mock";

// --- SUPABASE CONFIG ---
// Prefer loading from environment variables if available
const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://ytfozgxdilhiytygwnxu.supabase.co";
const SUPABASE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0Zm96Z3hkaWxoaXl0eWd3bnh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwNTAyNjIsImV4cCI6MjA3NzYyNjI2Mn0.jdYv8pXg9-p3CAm6MX6AIBXV3sO5v3JVEpE9sKdQCSI"; // anon key, not service key!

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TENANT_ID =
    process.env.FLOW402_TENANT_ID ||
    process.env.NEXT_PUBLIC_FLOW402_TENANT_ID ||
    "0b7d4b0a-6e10-4db4-8571-2c74e07bcb35";

// === BALANCE HELPER ===
async function showBalance() {
    const { data, error } = await supabase
        .from("credits")
        .select("balance_cents")
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", AGENT_USER_ID)
        .single();

    if (error) {
        console.error("⚠️ Balance fetch failed:", error.message);
        return;
    }

    const balanceCredits = data?.balance_cents ?? 0;
    const balanceUsd = (balanceCredits / 100).toFixed(2);
    console.log(`💳 Current balance: ${balanceCredits.toLocaleString()} credits (~$${balanceUsd} USDC)`);
}

// === MAIN LOGIC ===
async function callVendor() {
    await showBalance();
    console.log("🤖 Agent: Calling vendor API...");

    const res = await fetch(VENDOR_URL, {
        headers: { "x-user-id": AGENT_USER_ID },
    });

    if (res.status === 200) {
        const body = await res.json();
        console.log("✅ Success:", body);
        await showBalance();
        return;
    }

    if (res.status === 402) {
        console.log("💰 Received 402 – topping up...");
        const body = (await res.json()) as {
            price_credits: number;
            currency: string;
            topup_url?: string;
        };

        const need = body.price_credits * 10; // top up 10× required amount
        await fetch(GATEWAY_TOPUP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: AGENT_USER_ID, amount_credits: need }),
        });
        console.log(
            `🔄 Topped up ${need.toLocaleString()} credits (~$${(need / 100).toFixed(
                2
            )} USD). Retrying...`
        );
        return callVendor();
    }

    console.error(`❌ Unexpected response: ${res.status}`, await res.text());
}

// === EXECUTE ===
callVendor().catch(console.error);
