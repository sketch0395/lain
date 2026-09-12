import { auth, signOut } from "@/auth";
import ChatClient from "./ChatClient";

export default async function Home() {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <ChatClient
      userLabel={session?.user?.name || session?.user?.email}
      userImage={session?.user?.image}
      signOutAction={signOutAction}
    />
  );
}
