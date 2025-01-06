// src/index.js
import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Configure dotenv with the correct path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
console.log({
  supabase_url :   process.env.SUPABASE_URL,
  supabase_anon : process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET
})
// Plan map for subscriptions
const planMap = {
  price_1QdZAXIvZBeqKnwPvCm2ZyMz: { name: "gold", credits: 7000 },
  price_1QdZAbIvZBeqKnwPP6Fv2zK1: { name: "diamond", credits: 100000 },
  price_1QdZAeIvZBeqKnwP9vmmaAkW: { name: "elite", credits: 500000 },
};

// Use raw body parsing for Stripe webhooks
app.post('/webhook', express.raw({type: 'application/json'}), async (request, response) => {
  const sig = request.headers['stripe-signature'];
  let stripeEvent;

  try {
    // Verify the webhook signature
    stripeEvent = stripe.webhooks.constructEvent(
      request.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("Received Stripe webhook event:", stripeEvent.type);

    // Handle different event types
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        console.log("checkout completed started!!!");
        const session = stripeEvent.data.object;

        console.log("Processing checkout session:", session.id);

        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id
        );
        const priceId = lineItems.data[0]?.price?.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };

        console.log("Customer Email:", session?.customer_details?.email);
        if (!session?.customer_details?.email) {
          throw new Error("Customer email is missing");
        }

        const { data, error } = await supabase
          .from("users")
          .update({
            stripe_customer_id: session.customer,
            subscription_status: "active",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .ilike("email", session.customer_details.email);

        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated user subscription:", data);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = stripeEvent.data.object;
        console.log("Processing subscription deletion:", subscription.id);

        const { error } = await supabase
          .from("users")
          .update({
            subscription_status: "inactive",
            plan: "free",
            credits: 1000,
            subscription_updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully deactivated subscription");
        break;
      }

      case "customer.subscription.updated": {
        const subscription = stripeEvent.data.object;
        console.log("Processing subscription update:", subscription.id);

        const priceId = subscription.items.data[0]?.price.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };

        const { data, error } = await supabase
          .from("users")
          .update({
            subscription_status:
              subscription.status === "active" ? "active" : "inactive",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .ilike("stripe_customer_id", subscription.customer);

        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated subscription");
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    // Return a response to acknowledge receipt of the event
    response.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    response.status(400).json({
      error: err instanceof Error ? err.message : "Unknown error"
    });
  }
});

// Your existing route
app.get('/', (req, res) => {
  res.send('Hello, Express!');
});

const port = process.env.PORT || 7777;
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});