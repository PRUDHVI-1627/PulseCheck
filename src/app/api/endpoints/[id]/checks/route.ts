import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const hoursParam = new URL(req.url).searchParams.get("hours");
  const hours = hoursParam === null ? 24 : Number(hoursParam);
  if (!Number.isSafeInteger(hours) || hours < 1) {
    return NextResponse.json(
      { error: "Hours must be a positive integer" },
      { status: 400 }
    );
  }

  const { data: endpoint, error: endpointError } = await supabaseAdmin
    .from("endpoints")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (endpointError) {
    return NextResponse.json({ error: endpointError.message }, { status: 500 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  if (Number.isNaN(sinceDate.getTime())) {
    return NextResponse.json(
      { error: "Hours is too large" },
      { status: 400 }
    );
  }
  const since = sinceDate.toISOString();
  const { data: checks, error } = await supabaseAdmin
    .from("health_checks")
    .select("*")
    .eq("endpoint_id", id)
    .gte("checked_at", since)
    .order("checked_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(checks);
}
