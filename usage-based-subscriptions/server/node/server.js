const express = require('express');
const app = express();
const { resolve } = require('path');
const { v4: uuid } = require('uuid');
const bodyParser = require('body-parser');
// Replace if using a different env file or config
require('dotenv').config({ path: './.env' });

if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_PUBLISHABLE_KEY ||
  !process.env.BASIC ||
  !process.env.PREMIUM ||
  !process.env.STATIC_DIR ||
  !process.env.COMPTE_CONNECT_CLIENT_ID ||
  !process.env.COMPTE_CUSTOMER_CLIENT_ID
) {
  console.log(
    'The .env file is not configured. Follow the instructions in the readme to configure the .env file. https://github.com/stripe-samples/subscription-use-cases'
  );
  console.log('');
  process.env.STRIPE_SECRET_KEY
    ? ''
    : console.log('Add STRIPE_SECRET_KEY to your .env file.');

  process.env.STRIPE_PUBLISHABLE_KEY
    ? ''
    : console.log('Add STRIPE_PUBLISHABLE_KEY to your .env file.');

  process.env.BASIC
    ? ''
    : console.log(
        'Add BASIC priceID to your .env file. See repo readme for setup instructions.'
      );

  process.env.PREMIUM
    ? ''
    : console.log(
        'Add PREMIUM priceID to your .env file. See repo readme for setup instructions.'
      );

  process.env.STATIC_DIR
    ? ''
    : console.log(
        'Add STATIC_DIR to your .env file. Check .env.example in the root folder for an example'
      );
  process.env.COMPTE_CONNECT_CLIENT_ID
    ? ''
    : console.log(
        'Add COMPTE_CONNECT_CLIENT_ID to your .env file. Check .env.example in the root folder for an example'
      );
  process.env.COMPTE_CUSTOMER_CLIENT_ID
    ? ''
    : console.log(
        'Add COMPTE_CUSTOMER_CLIENT_ID to your .env file. Check .env.example in the root folder for an example'
      );

  process.exit();
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2020-08-27',
});

app.use(express.static(process.env.STATIC_DIR));
// Use JSON parser for all non-webhook routes.
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});

app.get('/', (req, res) => {
  const path = resolve(process.env.STATIC_DIR + '/index.html');
  res.sendFile(path);
});

app.get('/config', async (req, res) => {
  res.send({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

app.post('/create-customer', async (req, res) => {
  // Create a new customer object
  const customer = await stripe.customers.create({
    email: req.body.email,
  });

  // save the customer.id as stripeCustomerId
  // in your database.

  res.send({ customer });
});

app.post('/create-subscription', async (req, res) => {
  // Set the default payment method on the customer
  try {
    await stripe.paymentMethods.attach(req.body.paymentMethodId, {
      customer: req.body.customerId,
    });
  } catch (error) {
    return res.status('402').send({ error: { message: error.message } });
  }

  let updateCustomerDefaultPaymentMethod = await stripe.customers.update(
    req.body.customerId,
    {
      invoice_settings: {
        default_payment_method: req.body.paymentMethodId,
      },
    }
  );

  // Create the subscription
  const subscription = await stripe.subscriptions.create({
    customer: req.body.customerId,
    items: [{ price: process.env[req.body.priceId] }],
    expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
  });

  res.send(subscription);
});

app.post('/retry-invoice', async (req, res) => {
  // Set the default payment method on the customer

  try {
    await stripe.paymentMethods.attach(req.body.paymentMethodId, {
      customer: req.body.customerId,
    });
    await stripe.customers.update(req.body.customerId, {
      invoice_settings: {
        default_payment_method: req.body.paymentMethodId,
      },
    });
  } catch (error) {
    // in case card_decline error
    return res
      .status('402')
      .send({ result: { error: { message: error.message } } });
  }

  const invoice = await stripe.invoices.retrieve(req.body.invoiceId, {
    expand: ['payment_intent'],
  });
  res.send(invoice);
});

app.post('/retrieve-upcoming-invoice', async (req, res) => {
  const subscription = await stripe.subscriptions.retrieve(
    req.body.subscriptionId
  );

  const invoice = await stripe.invoices.retrieveUpcoming({
    subscription_prorate: true,
    customer: req.body.customerId,
    subscription: req.body.subscriptionId,
    subscription_items: [
      {
        id: subscription.items.data[0].id,
        clear_usage: true,
        deleted: true,
      },
      {
        price: process.env[req.body.newPriceId],
        deleted: false,
      },
    ],
  });
  res.send(invoice);
});

app.post('/cancel-subscription', async (req, res) => {
  // Delete the subscription
  const deletedSubscription = await stripe.subscriptions.del(
    req.body.subscriptionId
  );
  res.send(deletedSubscription);
});

app.post('/update-subscription', async (req, res) => {
  const subscription = await stripe.subscriptions.retrieve(
    req.body.subscriptionId
  );
  const updatedSubscription = await stripe.subscriptions.update(
    req.body.subscriptionId,
    {
      cancel_at_period_end: false,
      items: [
        {
          id: subscription.items.data[0].id,
          price: process.env[req.body.newPriceId],
        },
      ],
    }
  );

  res.send(updatedSubscription);
});

app.post('/create-product-and-prices', async (req, res) => {
  // Create a new Product
  const product = await stripe.products.create({
    name: 'Cour De Jean Maths',
    description: 'un produit pour announce de jean gautier ACCT',
    metadata: {
      seoId: 'developpeur-je-donne-des-cours-de-mathematiques-dinformatique-pour-tout-niveaux-et-pour-tout-mindset'
    }
  });
  const { id } = product;
  // Create a new Price For Priduct
  try {
  const price = await stripe.prices.create({
    currency: 'eur',
    recurring: {interval: 'month', usage_type: "metered", aggregate_usage: "sum" },
    billing_scheme: "tiered",
    tiers:[{
      flat_amount: 10000,
      unit_amount_decimal: 0,
      up_to: 240,
    },
    {
      unit_amount: 2200,
      up_to: 'inf'
    }],
    tiers_mode: "graduated",
    product: id,
    metadata: {
      availableMinutes: 240,
      availableMonths: 6,
    }
  });
  
  // save the price 
  // in your database.

  res.send({ price });
} catch (error) {
  console.log('erreur de prix',error?.message)
}
});

app.post('/create-subscription-between-J-and-J',async (req, res) => {
  try {
    // change the price id with the required one
    const subscription = await stripe.subscriptions.create({
      customer: process.env.COMPTE_CUSTOMER_CLIENT_ID,
      items: [
        {price: 'price_1LIwQKDnahqFVvJv90OnmVJL'},
      ],
      description: 'un produit pour announce de jean gautier ACCT',
      metadata: {
        seoId: 'developpeur-je-donne-des-cours-de-mathematiques-dinformatique-pour-tout-niveaux-et-pour-tout-mindset',
        teacherId: 'J-J',
        announceId: 'J-J-announce',
      },
      payment_behavior: "error_if_incomplete",
      cancel_at_period_end: true,
      application_fee_percent: 30,
      collection_method: "charge_automatically",
      cancel_at: Math.floor(new Date('september 19, 2020 23:15:30').getTime() / 1000),
      /** extrement interessant proration behavior: https://stripe.com/docs/billing/subscriptions/billing-cycle#prorations  */
      proration_behavior: 'create_prorations',
      transfer_data: {
        destination: process.env.COMPTE_CONNECT_CLIENT_ID,
        /** ne pas mettre transfert amount si application_fee_percent renseigné */
      }
    });
    res.send({ subscription });
  } catch (error) {
    console.log('erreur de subscirption',error?.message)
  }
});

app.post('/use-product',async (req, res) => {
  const minutesUsage = req.body.minutes;
  const timestamp = parseInt(Date.now() / 1000);
  /**  The idempotency key allows you to retry this usage record call if it fails. */
  const idempotencyKey = uuid();
  try {
   const usageRecord = await stripe.subscriptionItems.createUsageRecord(
      'si_M0yqKCA51nnVg0',
      {
        quantity: minutesUsage,
        timestamp: timestamp,
        action: 'set',
      },
      {
        idempotencyKey
      }
    );
    res.send({ usageRecord });
  } catch (error) {
    console.error(`Usage report failed for item: ${error.toString()}`);
  }
})

app.post('/retrieve-customer-payment-method', async (req, res) => {
  const paymentMethod = await stripe.paymentMethods.retrieve(
    req.body.paymentMethodId
  );

  res.send(paymentMethod);
});

app.post('/report-usage', async (req, res) => {
  const number = req.body.number;
  

});

app.post('/create-invoice-dmr', async ( req, res ) => {
  try {
    const invoiceItem = await stripe.invoiceItems.create({
      customer: process.env.COMPTE_CUSTOMER_CLIENT_ID,
      price: 'price_1LskdDDnahqFVvJvYNedjT3B',
      //invoice: '{{INVOICE_ID}}',
    });
    const data = await stripe.invoices.create({
      customer: process.env.COMPTE_CUSTOMER_CLIENT_ID,
      /** process auto collection method */
      auto_advance: true,
      collection_method: "charge_automatically",
      discounts: [{
        /** id d'une reduction */
        coupon: 'NbCQqcV1',
        /** id d'un objet discount */
       // discount: 'discount_1LJ0QKDnahqFVvJvZ5Z5Z5Z5',
      }],
      /** connect */
      //on_behalf_of: process.env.COMPTE_CONNECT_CLIENT_ID,
      /** payment intent option */
      // payment_settings: {
      //   payment_method_options
      // }
    });
    const invoice = await stripe.invoices.pay(
      data.id
    );
    res.send({ invoice });
  } catch (error) {
    console.log('erreur de subscirption',error?.message)
  }
});
// Webhook handler for asynchronous events.
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    console.log('i been call');
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(err);
      console.log(`⚠️  Webhook signature verification failed.`);
      console.log(
        `⚠️  Check the env file and enter the correct webhook secret.`
      );
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    const dataObject = event.data.object;
    console.log('webhook event', event.type);
    // Handle the event
    // Review important events for Billing webhooks
    // https://stripe.com/docs/billing/webhooks
    // Remove comment to see the various objects sent for this sample
    switch (event.type) {
      case 'invoice.paid':
        // Used to provision services after the trial has ended.
        // The status of the invoice will show up as paid. Store the status in your
        // database to reference when a user accesses your service to avoid hitting rate limits.
        break;
      case 'invoice.payment_failed':
        // If the payment fails or the customer does not have a valid payment method,
        //  an invoice.payment_failed event is sent, the subscription becomes past_due.
        // Use this webhook to notify your user that their payment has
        // failed and to retrieve new card details.
        break;
      case 'invoice.finalized':
        // If you want to manually send out invoices to your customers
        // or store them locally to reference to avoid hitting Stripe rate limits.
        break;
      case 'customer.subscription.deleted':
        if (event.request != null) {
          // handle a subscription cancelled by your request
          // from above.
        } else {
          // handle subscription cancelled automatically based
          // upon your subscription settings.
        }
        break;
      case 'customer.subscription.trial_will_end':
        // Send notification to your user that the trial will end
        break;
      default:
      // Unexpected event type
    }
    res.sendStatus(200);
  }
);

app.listen(4242, () => console.log(`Node server listening on port ${4242}!`));
