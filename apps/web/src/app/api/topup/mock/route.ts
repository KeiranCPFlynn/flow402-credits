import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Validate input
const Body = z.object({
    userId: z.string().uuid(),
    amount_cents: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
    try {
        const { userId, amount_cents } = Body.parse(await req.json());

        // ✅ Use NEXT_PUBLIC_ vars for Supabase URL, and server-side SERVICE_ROLE key
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Call your SQL function to increment balance
        const { error } = await supabase.rpc("increment_balance", {
            p_user: userId,
            p_amount: amount_cents,
        });

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("Mock top-up error:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
    }
}
