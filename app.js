import express from 'express';
import session from 'express-session';
import cors from 'cors';
import db from './database.js';
import bodyParser from 'body-parser';
import { BadCredentials, EmailNotPresent, UserAlreadyPresent } from './auth_expetion.js';
import { PlaceAlreadyBooked } from './booking_excepiton.js';
import { body, validationResult } from 'express-validator';
import helmet from 'helmet';
import User from './models/user.js';
import Stripe from 'stripe';
import {createOrder, captureOrder, calculateOrderAmount} from './payment/paypal.js';
import { checkPaymentStatus } from './payment/stripe.js'

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
}

const corsConfig = {
  origin: "http://localhost:5173",
  credentials: true 
}

app.use(cors(corsConfig));
app.use(session(sessionConfig));

// Home
app.get('/', async (req, res) => {
  if (req.session.login === undefined) {
    req.session.login = false;
    res.status(200).send('User not logged');
  } else {
    if(!req.session.login){
      res.status(200).send('User not logged');
    } else {
      try{
       
      } catch (err){
        if(err instanceof PlaceAlreadyBooked){
          res.status(400).send({msg: "Posto gia' occupato"});
          return;
        }
        console.log(err);
      }
     
      res.status(200).send('User is logged');
    }
  }
});

// Stripe
app.get('/initpayment', async (req, res) => {
  try {
    // Create a PaymentIntent with the order amount

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1000, // Amount in cents
      currency: 'eur',
    });
    req.session.paymentIntent = paymentIntent;
    req.session.paymentIntentId = paymentIntent.id;

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
    return;
  } catch (error) {
    res.status(500).send({ error: error.message });
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

app.post('/checkout', checkOutValidator, async (req, res) => { 
  
  const errors = validationResult(req);
    
  if (!errors.isEmpty()) {
    console.log("ERRORS IN PARAMS")
    return res.status(400).json({ errors: errors.array() });
  }

  console.log("checkout")
  const numChairs = req.body["chair"];

  try {
    const orderAmount = calculateOrderAmount(numChairs);
    if(req.session.paymentIntentId){
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

app.post("/confirm-stripe-payment", async (req, res) => {
  let isPaymentValid = await checkPaymentStatus(req.session.paymentIntentId);
  
  if(isPaymentValid === "succeeded"){
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
    } catch(err){

      console.log(err);
      return res.status(403).send(err);
      
    }  
  } else {
    return  res.status(403).send("Not Ok");
  }
});

app.post('/paypal-checkout', checkOutValidator, async (req, res) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const order = await createOrder(req);
    req.session.paypalOrderId = order.id;
    req.session.order = req.body;
    return res.json(order);

  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/paypal-buy', async (req, res) => {  
  try {
  
    if(req.session.paypalOrderId){
      const capture = await captureOrder(req, req.session.paypalOrderId);

      if(capture.status === "COMPLETED"){
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
        } catch(err){
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

    return res.status(403).send({error: "Error in payment flow"})
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
});


app.get('/booked', express.json(), async (req, res) => {
  try {
   
    if(req.session.login){
      let bookings = await db.getUserBookings(req.session.user.id);
      res.status(200).send(bookings);
      return;
    }
    res.status(400).send("user not logged");
    return;
   
  } catch (err){
    res.status(400).send(`ERROR ${err}`);
    return;
  }
})

app.get('/place', async (_, res) => {
  return res.status(200).send(await db.getPlaceList());
});

app.get('/booked-place-ratio', async (req, res) => {
  if(req.session.login === true){
    res.status(200).send(await db.getBookingRatios());
  } else {
    res.status(400).send("user not logged");
  }
});


const loginValidator = [
  body('email', 'Email non valida').isEmail()
]

app.post('/login', loginValidator, express.json(), async (req, res, next) => {
  console.log("LOGIN REQ SESSION");

  const errors = validationResult(req);
  console.log(req.body);

  if (req.session.login === false && errors.isEmpty()) {
    try {
      const data = req.body;
      let user = await db.login(data["email"], data["password"]);

      req.session.user = new User(user.id, user.name, user.surname, user.email, user.tel);

      res.cookie('name', user.name);
      res.cookie('surname', user.surname);
      
      req.session.login = true;
      res.status(200).send("login effettuato!");
    
    } catch (err) {
      if (err instanceof BadCredentials) {
        res.status(400).send({msg: "Credenziali errate"});
      } else if (err instanceof EmailNotPresent) {
        res.status(400).send({msg: "Nessun nostro utente utilizza questa mail"});
      } else {
        console.log(err);
        res.status(500).send({msg: "Internal Server Error"});
      }
    }
  } else if(!errors.isEmpty()) {
    res.status(400).send({ msg: "Credenziali errate", errors: errors.errors });
  } else {
    res.status(400).send({ msg: "Utente gia loggato" });
  }
  next();
});

// Auth section
export const signupValidator = [
  body('name', "Il campo congome non puo' rimanere vuoto" ).not().isEmpty(),
  body('surname', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('email', 'Email non valida').isEmail(),
  body('password', 'Password di almeno 6 caratteri').isLength({min: 6, max: 200}),
  body('tel', "Numero di telefono non valido").isLength({max: 10, min: 10})
]

app.post('/signup', signupValidator, async (req, res) => {
  const errors = validationResult(req);
  if(req.session.login === false && errors.isEmpty()){
    try {
      const data = req.body;
      await db.signUp(data["name"], data["surname"], data["email"], data["password"], data["tel"]);
      return res.status(200).send({ msg: "Utente creato si prega di fare login" });
    
    } catch (err) {
      console.log(err);

      if(err instanceof UserAlreadyPresent){
        return res.status(400).send({ msg: "Utente gia presente" });
      } else {
        console.error(err);
        return res.status(500).send({msg: "Internal Server Error"});
      }
    }
  } else if(!errors.isEmpty()) {
    return res.status(400).send({msg: "Credenziali errate", errors: errors.errors});
  } else{
    return res.status(304).send({ msg: "Utente gia' loggato"});
  }
});

export const editUserInfoValidator = [
  body('name', "Il campo congome non puo' rimanere vuoto" ).not().isEmpty(),
  body('surname', "Il campo congome non puo' rimanere vuoto").not().isEmpty(),
  body('email', 'Email non valida').isEmail(),
]

app.put('/edit-user-info', editUserInfoValidator, async (req, res) => {
  const errors = validationResult(req);
  if(req.session.login){
    if(errors.isEmpty()){
      req.session.user = await db.editUserInfo(req.body, req.session.user);
      console.log(req.session);
      return res.status(200).send("Dati modificati correttamente");
    } else{
      return res.status(400).send(errors.errors);
    }
  }else {
    return res.status(304).send({ msg: "Utente non loggato" });
  }
});

app.get('/logout', async (req, res) => {
  req.session.destroy();
  res.status(200).send({msg: "LogOut effettuato"});
});

app.get("/delbook", async (_, res) => {
  await db.removeAllReservations();
  res.status(200).send("ok")
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
