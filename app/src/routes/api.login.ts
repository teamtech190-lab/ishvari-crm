import { createFileRoute } from "@tanstack/react-router";
import { bindings } from "../lib/bindings.server";
import { makeSessionCookie } from "../lib/crm-auth.server";

export const Route = createFileRoute("/api/login")({
  server:{handlers:{POST:async ({request})=>{
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden",{status:403});
    const secret=bindings().CRM_PASSWORD;
    if(!secret) return Response.json({error:"CRM_PASSWORD is not configured."},{status:503});
    const body=await request.json().catch(()=>null) as {password?:string}|null;
    if(!body?.password || body.password.length>256 || body.password!==secret) return Response.json({error:"Invalid password"},{status:401});
    return Response.json({ok:true},{headers:{"Set-Cookie":await makeSessionCookie()}});
  }}}
});
