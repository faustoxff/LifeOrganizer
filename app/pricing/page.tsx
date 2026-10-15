import { redirect } from "next/navigation";

// /pricing is the conventional URL for the pricing page (and the one a payment
// reviewer will try); the page itself lives at /plans.
export default function Pricing() {
  redirect("/plans");
}
