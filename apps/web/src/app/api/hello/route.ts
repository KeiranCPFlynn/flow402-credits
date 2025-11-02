export async function GET() {
    console.log("ENV CHECK:", process.env.SUPABASE_URL);
    return Response.json({ ok: true });
}
