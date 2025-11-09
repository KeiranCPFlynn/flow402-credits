"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const tenantId = process.env.NEXT_PUBLIC_FLOW402_TENANT_ID;
const defaultUserId =
    process.env.NEXT_PUBLIC_DEMO_USER_ID || "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

if (!tenantId) {
    throw new Error("NEXT_PUBLIC_FLOW402_TENANT_ID is not configured");
}

const presetUsdAmounts = ["1", "5", "10"];

export default function DashboardPage() {
    const [balanceCredits, setBalanceCredits] = useState<number>(0);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [amountUsd, setAmountUsd] = useState<string>("5");
    const [isResetting, setIsResetting] = useState(false);
    const [isCharging, setIsCharging] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [chargeResult, setChargeResult] = useState<{
        status: number;
        ok: boolean;
        body: unknown;
        logs: string[];
    } | null>(null);
    const userId = defaultUserId;

    const fetchData = async () => {
        const { data: balanceData, error: balanceError } = await supabase
            .from("credits")
            .select("balance_cents")
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .maybeSingle();

        if (balanceError) {
            console.error(
                "Balance fetch error:",
                balanceError.message ?? balanceError,
                balanceError.code ?? ""
            );
        }

        const { data: txData, error: txError } = await supabase
            .from("tx_ledger")
            .select("kind, amount_cents, created_at, ref")
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(10);

        if (txError) console.error("Transactions error:", txError);

        const latestBalance = balanceData?.balance_cents ?? 0;
        const normalizedTransactions =
            txData?.map((tx) => ({ ...tx, amount_credits: tx.amount_cents })) ?? [];

        setBalanceCredits(latestBalance);
        setTransactions(normalizedTransactions);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleTopup = async (e: React.FormEvent) => {
        e.preventDefault();
        const numeric = parseFloat(amountUsd);
        if (isNaN(numeric) || numeric <= 0) {
            alert("Enter a valid amount");
            return;
        }

        const amountCredits = Math.round(numeric * 100);
        const res = await fetch("/api/topup/mock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, amount_credits: amountCredits }),
        });

        if (!res.ok) {
            console.error("Top-up failed", await res.text());
            alert("Top-up failed");
            return;
        }

        await fetchData();
        setAmountUsd("5");
        setActionMessage(
            `Issued ${amountCredits.toLocaleString()} credits ($${numeric.toFixed(2)} USD)`
        );
    };

    const handleReset = async () => {
        setIsResetting(true);
        setActionMessage(null);

        try {
            const res = await fetch("/api/topup/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });

            const json = await res.json();
            if (!res.ok || !json.ok) {
                console.error("Reset failed", json);
                alert("Reset failed");
                return;
            }

            await fetchData();
            setActionMessage(
                `Balance reset from ${(json.previous_balance_credits ?? 0).toLocaleString()} credits to 0`
            );
            setChargeResult(null);
        } catch (err) {
            console.error("Reset error", err);
            alert("Reset failed");
        } finally {
            setIsResetting(false);
        }
    };

    const handleChargeSimulation = async () => {
        setIsCharging(true);
        setChargeResult(null);
        setActionMessage(null);

        try {
            const res = await fetch("/api/demo/charge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });
            const json = await res.json();

            setChargeResult({
                status: json.status ?? res.status,
                ok: json.ok ?? res.ok,
                body: json.body ?? null,
                logs: Array.isArray(json.logs) ? json.logs : [],
            });

            if (!res.ok) {
                console.error("Charge simulation failed", json);
                if (json.error === "auto_topup_failed") {
                    alert("Auto top-up failed. Check Supabase credentials.");
                } else {
                    alert("Charge simulation failed");
                }
                return;
            }

            await fetchData();
        } catch (err) {
            console.error("Charge simulation error", err);
            alert("Charge simulation failed");
        } finally {
            setIsCharging(false);
        }
    };

    const parsedUsd = parseFloat(amountUsd);
    const upcomingCredits =
        !isNaN(parsedUsd) && parsedUsd > 0 ? Math.round(parsedUsd * 100) : 0;

    return (
        <main className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-3 text-gray-800">Flow402 Dashboard</h1>
                <p className="text-gray-600 mb-6">
                    This dashboard shows live API credits for a Flow402 user. Each API call deducts
                    credits before the vendor responds. Customers pay in USDC (or fiat later) and receive
                    credits instantly.
                </p>

                <div className="bg-white shadow-md rounded-2xl p-6 mb-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-2">Current Balance</h2>
                    <p className="text-3xl font-bold text-green-600">
                        {balanceCredits.toLocaleString()} credits
                    </p>
                    <p className="text-sm text-gray-500">
                        (~${(balanceCredits / 100).toFixed(2)} USD equivalent)
                    </p>

                    <label className="mt-4 block text-sm font-medium text-gray-600">
                        Top-up amount (USD)
                    </label>
                    <form onSubmit={handleTopup} className="flex flex-col gap-3 mt-2">
                        <div className="flex flex-wrap gap-2">
                            {presetUsdAmounts.map((preset) => (
                                <button
                                    type="button"
                                    key={preset}
                                    onClick={() => setAmountUsd(preset)}
                                    className={`rounded-lg border px-3 py-1 text-sm ${
                                        amountUsd === preset
                                            ? "bg-blue-600 text-white border-blue-600"
                                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                                    }`}
                                >
                                    ${preset} ({(parseFloat(preset) * 100).toLocaleString()} credits)
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-600">$</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amountUsd}
                                onChange={(e) => setAmountUsd(e.target.value)}
                                className="border rounded-lg p-2 flex-1"
                                placeholder="5"
                            />
                        </div>
                        <p className="text-sm text-gray-500">
                            You&apos;ll issue {upcomingCredits.toLocaleString()} credits to the user.
                        </p>
                        <div className="flex justify-end">
                            <button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                            >
                                + Add Credit
                            </button>
                        </div>
                    </form>

                    <button
                        type="button"
                        onClick={handleReset}
                        disabled={isResetting}
                        className="mt-4 text-sm text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 disabled:opacity-60"
                    >
                        {isResetting ? "Resetting..." : "Reset balance to 0 credits"}
                    </button>

                    {actionMessage && (
                        <p className="mt-3 text-sm text-gray-600">{actionMessage}</p>
                    )}
                </div>

                <div className="bg-white shadow-md rounded-2xl p-6 mb-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-2">Demo Actions</h2>
                    <p className="text-gray-600 text-sm mb-4">
                        Trigger the end-to-end flow right from the dashboard. We call the vendor demo
                        service; if the balance is empty you&apos;ll see the 402, we auto top-up, and then
                        retry so you can walk through both states back to back.
                    </p>
                    <button
                        type="button"
                        onClick={handleChargeSimulation}
                        disabled={isCharging}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg disabled:opacity-60"
                    >
                        {isCharging ? "Calling vendor demo..." : "Simulate paid API call"}
                    </button>

                    {chargeResult && (
                        <div className="mt-4 text-sm text-gray-700">
                            <p>
                                Gateway response:&nbsp;
                                <span
                                    className={
                                        chargeResult.status === 200 ? "text-emerald-600" : "text-amber-600"
                                    }
                                >
                                    {chargeResult.status}
                                </span>
                            </p>
                            {chargeResult.logs?.length > 0 && (
                                <div className="mt-2">
                                    <p className="font-medium text-gray-600">Trace</p>
                                    <pre className="mt-1 bg-gray-100 rounded-lg p-3 overflow-auto text-xs text-gray-600">
                                        {chargeResult.logs.join("\n")}
                                    </pre>
                                </div>
                            )}
                            <pre className="mt-2 bg-gray-100 rounded-lg p-3 overflow-auto text-xs text-gray-600">
                                {JSON.stringify(chargeResult.body, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>

                <div className="bg-white shadow-md rounded-2xl p-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Recent Transactions</h2>
                    <table className="w-full text-left border-t">
                        <thead>
                            <tr className="text-gray-500 uppercase text-sm">
                                <th className="py-2">Action</th>
                                <th className="py-2">Amount (credits)</th>
                                <th className="py-2">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.length > 0 ? (
                                transactions.map((tx, i) => (
                                    <tr key={i} className="border-t">
                                        <td className="py-2 text-gray-700">
                                            {tx.kind === "deduct" && tx.ref?.startsWith("manual_reset")
                                                ? "reset"
                                                : tx.kind}
                                        </td>
                                        <td className="py-2 text-gray-700">
                                            {tx.amount_credits.toLocaleString()}
                                        </td>
                                        <td className="py-2 text-gray-500">
                                            {new Date(tx.created_at).toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={3} className="text-gray-400 text-center py-4">
                                        No transactions yet
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
