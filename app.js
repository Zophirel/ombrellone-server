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
import ShortUniqueId from "short-unique-id";
const { randomUUID } = new ShortUniqueId({ length: 10 });

const app = express();

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

app.get('/booked-place-ratio', async (req, res) => {
  res.status(200).send(await db.getBookingRatios());
  /*if(req.session.isLogin === true){
    res.status(200).send(await db.getBookingRatios());
  } else {
    res.status(400).send("user not logged");
  }*/
});

export const bookingValidator = [
  body('row', "Il campo row non puo' rimanere vuoto").not().isEmpty(),
  body('row', "Campo row errato").matches(/^(?:[1-9]|1[0-5])$/),
  body('column', "Il campo column non puo' rimanere vuoto").not().isEmpty(),
  body('column', "Campo column errato").matches(/^[A-J]$/),
  body('date', "Il campo date non puo' rimanere vuoto").not().isEmpty(),
  body('chair', "Il campo chair non puo' rimanere vuoto").not().isEmpty(),
  body('chair', "Campo chair errato").matches(/^[1-4]$/)
];

app.post('/book', bookingValidator, express.json(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  if (req.session.login === true) {
    try {
   
      res.status(200).send(
        await db.makeReservation(
          req.session.user, 
          req.body["column"], 
          req.body["row"], 
          req.body["date"], 
          req.body["chair"]
        )
      );
      return;
    } catch (err) {
      if (err instanceof PlaceAlreadyBooked) {
        res.status(400).send({ msg: "Posto gia' occupato" });
        return;
      }
      console.log(err);
      res.status(500).send({ msg: "Errore del server" });
    }
  } else {
    res.status(403).send("user not logged");
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

app.get('/place', async (req, res) => {
  res.status(200).send(await db.getPlaceList());
});


app.get('/', async (req, res) => {
  if (req.session.login === undefined) {
    req.session.login = false;
    res.status(200).send('User not logged');
  } else {
    if(!req.session.login){
      res.status(200).send('User not logged');
    } else {
      try{
        //await db.makeReservation(req.session.user, 'A', 0, new Date('06-03-2024'));
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
      res.status(200).send({ msg: "Utente creato si prega di fare login" });
    
    } catch (err) {
      console.log(err);

      if(err instanceof UserAlreadyPresent){
        res.status(400).send({ msg: "Utente gia presente" });
      } else {
        console.error(err);
        res.status(500).send({msg: "Internal Server Error"});
      }
    }
  } else if(!errors.isEmpty()) {
    res.status(400).send({msg: "Credenziali errate", errors: errors.errors});
  } else{
    res.status(304).send({ msg: "Utente gia' loggato"});
  }
});

app.get('/logout', async (req, res) => {
  req.session.destroy();
  res.status(200).send({msg: "LogOut effettuato"});
});

app.get("/delbook", async (req, res) => {
  await db.removeAllReservations();
  res.status(200).send("ok")
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
