import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId)
        return NextResponse.json({ error: "userId required" }, { status: 400 });

    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!
    );

    const { data, error } = await supabase
        .from("credits")
        .select("balance_cents")
        .eq("user_id", userId)
        .single();

    if (error && error.code !== "PGRST116") {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ balance_cents: data?.balance_cents ?? 0 });
}
