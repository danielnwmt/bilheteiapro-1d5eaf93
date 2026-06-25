import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const checkEmailExists = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ email: z.string().trim().email().max(255) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .limit(1);
    if (error) return { exists: false };
    return { exists: (rows?.length ?? 0) > 0 };
  });
