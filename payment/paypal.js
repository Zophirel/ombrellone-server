const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API = process.env.PAYPAL_API; 

const calculateOrderAmount = (numChairs) => {
    const basePrice = 10;
    const chairPrice = 5;
    return basePrice + (numChairs > 1 ? (numChairs -1) * chairPrice : 0);
};

const paypalToken = async (req) => {
    if (req.session.paypalAccessToken) {
        return req.session.paypalAccessToken;
    }

    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
    const response = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    req.session.paypalAccessToken = response.data.access_token;
    return req.session.paypalAccessToken;
};

const generateAccessToken = async (req) => {
    if (req.session.paypalAccessToken) {
        return req.session.paypalAccessToken;
    }

    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    const data = await response.json();
    req.session.paypalAccessToken = data.access_token;
    return data.access_token;
};

const createOrder = async (req) => {
    const amount = calculateOrderAmount(req.body['chair']);
    const accessToken = await generateAccessToken(req);

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
        },
        body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
                amount: {
                currency_code: 'EUR',
                value: amount
                }
            }]
        })
    });

    return await response.json();
};
  
const captureOrder = async (req, orderId) => {
    const accessToken = await generateAccessToken(req);
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
        }
    });

    return await response.json();
};

export {createOrder, captureOrder,  paypalToken, calculateOrderAmount}


  