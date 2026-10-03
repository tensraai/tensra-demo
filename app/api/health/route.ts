export const dynamic = "force-dynamic";

// GET /api/health  -> used by the host to check the server is up
export function GET() {
  return Response.json({ ok: true });
}
