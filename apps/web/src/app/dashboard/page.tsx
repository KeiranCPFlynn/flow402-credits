"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function DashboardPage() {
    const [balance, setBalance] = useState<number>(0);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [amount, setAmount] = useState<string>("5");
    const userId = "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

    // 🔄 Fetch credits + recent transactions
    const fetchData = async () => {
        const { data: balanceData, error: balanceError } = await supabase
            .from("credits")
            .select("balance_cents")
            .eq("user_id", userId)
            .single();

        if (balanceError) console.error("Balance error:", balanceError);

        const { data: txData, error: txError } = await supabase
            .from("tx_ledger")
            .select("kind, amount_cents, created_at")
            .order("created_at", { ascending: false })
            .limit(10);

        if (txError) console.error("Transactions error:", txError);

        setBalance(balanceData ? balanceData.balance_cents / 100 : 0);
        setTransactions(txData || []);
    };

    useEffect(() => {
        fetchData();
    }, []);

    // 💳 Handle top-up
    const handleTopup = async (e: React.FormEvent) => {
        e.preventDefault();
        const numeric = parseFloat(amount);
        if (isNaN(numeric) || numeric <= 0) {
            alert("Enter a valid amount");
            return;
        }

        const amountCents = Math.round(numeric * 100);
        const res = await fetch("/api/topup/mock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, amount_cents: amountCents }),
        });

        if (!res.ok) {
            console.error("Top-up failed", await res.text());
            alert("Top-up failed");
            return;
        }

        await fetchData();
        setAmount("5");
        alert(`Added $${numeric.toFixed(2)} credits ✅`);
    };

    return (
        <main className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-3 text-gray-800">Flow402 Dashboard</h1>
                <p className="text-gray-600 mb-6">
                    This dashboard shows live API credits for a Flow402 user. Each API call deducts
                    micro-amounts from their balance. Top-ups simulate credit purchases in USDC.
                </p>

                <div className="bg-white shadow-md rounded-2xl p-6 mb-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-2">Current Balance</h2>
                    <p className="text-3xl font-bold text-green-600">
                        ${balance.toFixed(2)} USDC
                    </p>

                    <form onSubmit={handleTopup} className="flex items-center gap-3 mt-4">
                        <input
                            type="number"
                            step="0.01"
                            min="0.5"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="border rounded-lg p-2 w-32"
                            placeholder="Top-up amount"
                        />
                        <button
                            type="submit"
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                        >
                            + Add Credit
                        </button>
                    </form>
                </div>

                <div className="bg-white shadow-md rounded-2xl p-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Recent Transactions</h2>
                    <table className="w-full text-left border-t">
                        <thead>
                            <tr className="text-gray-500 uppercase text-sm">
                                <th className="py-2">Action</th>
                                <th className="py-2">Amount (USDC)</th>
                                <th className="py-2">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.length > 0 ? (
                                transactions.map((tx, i) => (
                                    <tr key={i} className="border-t">
                                        <td className="py-2 text-gray-700">{tx.kind}</td>
                                        <td className="py-2 text-gray-700">
                                            {(tx.amount_cents / 100).toFixed(2)}
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
