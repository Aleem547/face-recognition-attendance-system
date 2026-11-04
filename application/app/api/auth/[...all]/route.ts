import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request: Request) {
  try {
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    console.error("Face Recognition Attendance System authentication request could not be completed.");
    return Response.json({ error: "Authentication is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export { handler as GET, handler as POST };
