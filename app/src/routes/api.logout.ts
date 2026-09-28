import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "../lib/crm-auth.server";
export const Route=createFileRoute("/api/logout")({server:{handlers:{POST:async()=>Response.json({ok:true},{headers:{"Set-Cookie":clearSessionCookie()}})}}});
