import { Redirect } from 'expo-router';

// Entry point. Which screen the app really opens on (onboarding vs. a restored
// session) is decided by the store, which is ported in the next step.
export default function Index() {
  return <Redirect href="/onboarding" />;
}
