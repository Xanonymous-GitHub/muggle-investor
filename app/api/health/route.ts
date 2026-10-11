export function GET(): Response {
  return Response.json({ status: "ok", app: "muggle-investor" });
}
