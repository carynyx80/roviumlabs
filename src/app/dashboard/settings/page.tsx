import type { Metadata } from "next";
import { SettingsForm } from "@/components/dashboard/account-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsForm />;
}
