import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const tenantId = process.env.FLOW402_TENANT_ID;
const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req: NextRequest) {
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId)
        return NextResponse.json({ error: "userId required" }, { status: 400 });

    if (!tenantId || !supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json(
            { error: "config_missing" },
            { status: 500 }
        );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
        .from("credits")
        .select("balance_cents")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .single();

    if (error && error.code !== "PGRST116") {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const balanceCredits = data?.balance_cents ?? 0;
    return NextResponse.json({ balance_credits: balanceCredits });
}
