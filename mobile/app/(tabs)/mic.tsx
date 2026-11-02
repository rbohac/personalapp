import { Redirect } from "expo-router";

/** The tab bar's mic slot. Its button opens /capture; landing here by any other way goes home. */
export default function MicTab() {
  return <Redirect href="/" />;
}
