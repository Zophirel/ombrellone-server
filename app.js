import express from 'express';
import session from 'express-session';
import cors from 'cors';
import db from './database.js';
import bodyParser from 'body-parser';
import { BadCredentials, EmailNotPresent, UserAlreadyPresent } from './auth_expetion.js';
import { body, validationResult } from 'express-validator';
import helmet from 'helmet';
import User from './models/user.js';
import Stripe from 'stripe';
import { createOrder, captureOrder, calculateOrderAmount } from './payment/paypal.js';
import { checkPaymentStatus } from './payment/stripe.js';
import { ChangePasswordTokenExpired, ChangePasswordTokenAlreadyPresent, ChangePasswordTokenNotValid } from './token_exeption.js';

const app = express();
const stripe = new Stripe(process.env.STRIPE_KEY);

app.use(helmet());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sessionConfig = {
  secret: process.env.NODE_SESSION_PASSWORD,
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 3600000,
    httpOnly: true,
    secure: false,
  },
};

const corsConfig = {
  origin: "http://localhost:5173",
  credentials: true
};

app.use(cors(corsConfig));
app.use(session(sessionConfig));

// Middleware to check if user is logged in
function isUserLoggedIn(req, res, next) {
  if (!req.session.login) {
    return res.status(400).send('User not logged');
  }
  next();
}

// Middleware to handle validation errors
function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// Home
app.get('/', async (req, res) => {
  if (!req.session.login) {
    req.session.login = false;
    return res.status(200).send('User not logged');
  }
  return res.status(200).send('User is logged');
});

// Stripe
app.get('/initpayment', isUserLoggedIn, async (req, res) => {
  try {
    // Create a PaymentIntent with the order amount
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1000, // Amount in cents
      currency: 'eur',
    });
    req.session.paymentIntent = paymentIntent;
    req.session.paymentIntentId = paymentIntent.id;

    return res.send({
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
});

export const checkOutValidator = [
  body('row', "Il campo row non puo' rimanere vuoto").not().isEmpty(),
  body('row', "Campo row errato").matches(/^(?:[1-9]|1[0-5])$/),
  body('column', "Il campo column non puo' rimanere vuoto").not().isEmpty(),
  body('column', "Campo column errato").matches(/^[A-J]$/),
  body('date', "Il campo date non puo' rimanere vuoto").not().isEmpty(),
  body('chair', "Il campo chair non puo' rimanere vuoto").not().isEmpty(),
  body('chair', "Campo chair errato").matches(/^[1-4]$/)
];

app.post('/checkout', isUserLoggedIn, checkOutValidator, validateRequest, async (req, res) => {
  console.log("checkout");
  const numChairs = req.body["chair"];

  try {
    const orderAmount = calculateOrderAmount(numChairs);
    if (req.session.paymentIntentId) {
      // Update existing PaymentIntent
      const paymentIntent = await stripe.paymentIntents.update(req.session.paymentIntentId, {
        amount: orderAmount * 100, // Amount in cents
        currency: 'eur',
      });
      req.session.order = req.body;
      return res.send({
        clientSecret: paymentIntent.client_secret,
      });

    } else {
      return res.status(500).send({ error: "Error in payment flow" });
    }
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
});

app.post("/confirm-stripe-payment", isUserLoggedIn, async (req, res) => {
  let isPaymentValid = await checkPaymentStatus(req.session.paymentIntentId);

  if (isPaymentValid === "succeeded") {
    try {
      // Save reservation in db
      res.status(200).send(
        await db.makeReservation(
          req.session.user,
          req.session.order.column,
          req.session.order.row,
          req.session.order.date,
          req.session.order.chair
        ));

      req.session.paymentIntentId = undefined;
      req.session.paymentIntent = undefined;
      req.session.orderId = undefined;
      req.session.order = undefined;

      return;
    } catch (err) {
      console.log(err);
      return res.status(403).send(err);
    }
  } else {
    return res.status(403).send("Not Ok");
  }
});

app.post('/paypal-checkout', isUserLoggedIn, checkOutValidator, validateRequest, async (req, res) => {
  try {
    const order = await createOrder(req);
    req.session.paypalOrderId = order.id;
    req.session.order = req.body;
    return res.json(order);

  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/paypal-buy', isUserLoggedIn, async (req, res) => {
  try {
    if (req.session.paypalOrderId) {
      const capture = await captureOrder(req, req.session.paypalOrderId);

      if (capture.status === "COMPLETED") {
        try {
          // Save reservation in db
          res.status(200).send(
            await db.makeReservation(
              req.session.user,
              req.session.order.column,
              req.session.order.row,
              req.session.order.date,
              req.session.order.chair
            ));

          req.session.paymentIntentId = undefined;
          req.session.paymentIntent = undefined;
          req.session.orderId = undefined;
          req.session.order = undefined;

          return;
        } catch (err) {
          console.log(err);
          return res.status(403).send(err);
        }
      }

      req.session.paymentIntentId = undefined;
      req.session.paymentIntent = undefined;
      req.session.orderId = undefined;
      req.session.order = undefined;
      return res.json(capture);
    }

    return res.status(403).send({ error: "Error in payment flow" });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
});

app.get('/booked', isUserLoggedIn, express.json(), async (req, res) => {
  try {
    let bookings = await db.getUserBookings(req.session.user.id);
    return res.status(200).send(bookings);
  } catch (err) {
    return res.status(400).send(`ERROR ${err}`);
  }
});

app.get('/place', isUserLoggedIn, async (_, res) => {
  return res.status(200).send(await db.getPlaceList());
});

app.get('/booked-place-ratio', isUserLoggedIn, async (req, res) => {
  return res.status(200).send(await db.getBookingRatios());
});

const loginValidator = [
  body('email', 'Email non valida').isEmail(),
  body('password', "Il campo password non può rimanere vuoto").not().isEmpty()
];

app.post('/login', loginValidator, express.json(), validateRequest, async (req, res, next) => {
  console.log("LOGIN REQ SESSION");

  if (req.session.login) {
    return res.status(400).send('User already logged');
  }

  try {
    const data = req.body;
    let user = await db.login(data["email"], data["password"]);

    req.session.user = new User(user.id, user.name, user.surname, user.email, user.tel);

    res.cookie('name', user.name);
    res.cookie('surname', user.surname);

    req.session.login = true;
    return res.status(200).send("login effettuato!");

  } catch (err) {
    if (err instanceof BadCredentials) {
      return res.status(400).send({ msg: "Credenziali errate" });
    } else if (err instanceof EmailNotPresent) {
      return res.status(400).send({ msg: "Nessun nostro utente utilizza questa mail" });
    } else {
      return res.status(500).send({ msg: "Internal Server Error" });
    }
  }
});

// Auth section
export const signupValidator = [
  body('name', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('surname', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('email', 'Email non valida').isEmail(),
  body('password', 'Password di almeno 6 caratteri').isLength({ min: 6, max: 200 }),
  body('tel', "Numero di telefono non valido").isLength({ max: 10, min: 10 })
];

app.post('/signup', signupValidator, validateRequest, async (req, res) => {
  if (req.session.login === false) {
    try {
      const data = req.body;
      await db.signUp(data["name"], data["surname"], data["email"], data["password"], data["tel"]);
      return res.status(200).send({ msg: "Utente creato si prega di fare login" });

    } catch (err) {
      if (err instanceof UserAlreadyPresent) {
        return res.status(400).send({ msg: "Utente gia presente" });
      } else {
        console.error(err);
        return res.status(500).send({ msg: "Internal Server Error" });
      }
    }
  } else {
    return res.status(304).send({ msg: "Utente gia' loggato" });
  }
});

export const editUserInfoValidator = [
  body('name', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('surname', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('email', 'Email non valida').isEmail(),
];

app.put('/edit-user-info', isUserLoggedIn, editUserInfoValidator, validateRequest, async (req, res) => {
  req.session.user = await db.editUserInfo(req.body, req.session.user);
  return res.status(200).send("Dati modificati correttamente");
});

app.post('/logout', async (req, res) => {
  if(req.session.login){
    req.session.destroy();
    return res.status(200).send({ msg: "LogOut effettuato" });
  } else {
    return res.status(400).send({ msg: "Utente non loggato" });
  }  
});

export const requestChangePasswordValidator = [
  body('email', 'Email non valida').isEmail(),
];

app.post('/request-change-password', requestChangePasswordValidator, validateRequest, async (req, res) => {
  try{
    const token = await db.setChangePasswordToken(req.body);
    return res.status(200).send({msg: `È stata mandata una mail con il link per cambiare la password ${token}`});
  } catch (err) {
    console.log(err);
    if(err instanceof EmailNotPresent){
      res.status(400).send({error: "Email non valida"})
    } else if( err instanceof ChangePasswordTokenAlreadyPresent ){
      res.status(400).send({error: "Email per il cambio della password già inviata"})
    } else if( err instanceof ChangePasswordTokenExpired ){
      await db.resetChangePasswordToken(req.body);
      const token = await db.setChangePasswordToken(req.body);
      res.status(200).send({msg: `È stata mandata una mail con il link per cambiare la password ${token}`});
    }
  } 
})

export const changePasswordValidator = [
  body('password', 'Password di almeno 6 caratteri').isLength({ min: 6, max: 200 }),
];

app.post('/change-password', changePasswordValidator, validateRequest, async (req, res) => {
  try{
    await db.changePassword(req.body);
    return res.status(200).send({msg: `La password è stata modificata, si prega di fare login`})
  } catch (err) {
    if( err instanceof ChangePasswordTokenNotValid){
      res.status(400).send({error: "Token cambio password non valido, si prega di usare il link inviato nella mail"})
    } else if( err instanceof ChangePasswordTokenExpired ){
      await db.resetChangePasswordToken(req.body);
      res.status(400).send({error: "Procedura di cambio password scaduta si prega di riprovare nuovamente"})
    }
  }
})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
