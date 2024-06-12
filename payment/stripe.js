import Stripe from 'stripe';
async function checkPaymentStatus(paymentIntentId) {
    try {
        console.log(paymentIntentId);
        const stripe = new Stripe(process.env.STRIPE_KEY)
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        return paymentIntent.status;
    } catch (error) {
        console.error('Error retrieving PaymentIntent:', error);
        throw error;
    }
  }

export { checkPaymentStatus }