import { redirect } from "next/navigation";

export default function Home() {
  // Home is the workspace (your mapped fields), not the create form.
  redirect("/landscapes");
}
