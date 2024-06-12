import { MongoClient, ServerApiVersion } from "mongodb";
import { UserAlreadyPresent, EmailNotPresent, BadCredentials } from "./auth_expetion.js";
import { promisify } from 'util';
import { compare, genSalt, hash as _hash } from "bcrypt";
import ShortUniqueId from "short-unique-id";
import crypto from 'crypto';

import { 
    PlaceAlreadyBooked, 
    PlaceBookingDeletionNotPermitted, 
    PlaceNotBooked,
} from "./booking_excepiton.js"
const { randomUUID } = new ShortUniqueId({ length: 8 });

const bcryptCompare = promisify(compare);   
const uri = process.env.DBURI;
const DBNAME = process.env.DBNAME;

const client = new MongoClient(uri,  {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    }
);

async function insertBeach(){
    const db = client.db(DBNAME);
    const beaches = db.collection("beach");
    

    let beach = {
        id: randomUUID(),
        name: "Lido 1",
        places: places
    }

    beaches.insertOne(beach);
}

async function setPlaces(){
        
    const db = client.db(DBNAME);
    const places = db.collection("beach_place");
    let j = 1;
    let filaCounter = 1;
    
    for(let i = 0; i < 150; i++){
      
        let place = {   
            id: randomUUID(),
            beachId: '4gZNmQXk',
            row: `${String.fromCharCode(64 + filaCounter)}`,
            index: j % 16,
            reservations: []
        }

        j++;
        if(j % 16 === 0){
            j++;
            filaCounter++;
        }
        
        places.insertOne(place);
    }
}

/// Auth

// TODO: email verification needed
async function signUp(name, surname, email, password, tel) {
    const db = client.db(DBNAME);
    const users = db.collection("user");
    const checkedUser = await users.findOne({ $or: [{ email: email }, { tel: tel }] });

    if(checkedUser == null){           
        genSalt(10, function(_, salt) {
            _hash(password, salt, async function(err, hash) {
                let user = {
                    "id" :  randomUUID(),
                    "name" : name,
                    "surname" : surname,
                    "email" : email,
                    "password" : hash,
                    "tel" : tel
                }
                await users.insertOne(user);
            });
        });
        return;
    } else {
        throw new UserAlreadyPresent();
    }
  }

  async function login(email, password) {

    const db = client.db(DBNAME);
    const users = db.collection("user");
    const checkedUser = await users.findOne({email: email});
    
    if(checkedUser != null){
        let result = await bcryptCompare(password, checkedUser.password);
        if(result){
            console.log("user logged");
            return checkedUser;
        } else {
            console.log("bad credentials");
            throw new BadCredentials();
        }
    }else{
        console.log("email not present");
        throw new EmailNotPresent();
    }
  }

  /// Reservation
// AES encryption function
function encrypt(text) {
    const iv = crypto.randomBytes(16); // Initialization vector
    console.log("env");
    console.log(process.env);
    console.log("qr key");
    console.log(process.env.QR_KEY);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.QR_KEY, 'hex'), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// AES decryption function
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.QR_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}


async function makeReservation(user, row, placeIndex, date, chair){

    const db = client.db(DBNAME);
    const beachPlaces = db.collection("beach_place");    
    const beachPlacesReservation = db.collection("beach_place_reservation");
    const users = db.collection("user"); 
    const beaches = db.collection("beach"); 

    const filterReservations = {
        beachId: '4gZNmQXk',
        placeRow: row,
        placeIndex: placeIndex,
        date: date
    };

    let placeToBook = await beachPlacesReservation.findOne(filterReservations);
    let bookingId = new ShortUniqueId({ length: 10 });

    // place to book is not booked yet
    if(placeToBook === null){
        const bookingData = {
            id: bookingId.randomUUID(),
            beachId: '4gZNmQXk',
            userId: user.id,
            userName: user.name,
            userSurname: user.surname,
            date: date,
            added: new Date().toISOString(),
            placeRow: row,
            placeIndex: placeIndex,
            chairs: chair,
            price: 10 + (chair > 1 ? 5 * chair : 0)
        };

        bookingData.qrData = encrypt(JSON.stringify(bookingData));

        await beachPlacesReservation.insertOne(bookingData);
        await beachPlaces.updateOne({index: placeIndex, row: row}, {$addToSet: {reservations: date}});

        // Fetch the booking details
        const booking = await beachPlacesReservation.findOne({ id: bookingData.id });

        if (booking) {
            console.log("BOOKING");
            console.log(booking);

            // Fetch user details
            const userDetails = await users.findOne({ id: booking.userId }, { projection: { _id: 0, name: 1, surname: 1 } });
            // Fetch beach details
            const beachDetails = await beaches.findOne({ id: booking.beachId }, { projection: { _id: 0, name: 1 } });

            // Merge details
            booking.userName = userDetails.name;
            booking.userSurname = userDetails.surname;
            booking.beachName = beachDetails.name;

            delete booking.userId;
            delete booking.beachId;
            delete booking._id;
        }

        return booking;
    } else {
        throw new PlaceAlreadyBooked();
    }
}

async function removeAllReservations(){
    const db = client.db(DBNAME);
    const beachPlaces = db.collection("beach_place");
    
    const filter = {
        reservations: {
            $exists: true,
            $not: { $size: 0 }
        },
    }

    const updateFilter = { 
        $set: { reservations: [] }
    }

    await beachPlaces.updateMany( filter, updateFilter );
   
}

async function deleteReservation(user, placeIndex, date){
    const db = client.db(DBNAME);
    const beachPlaces = db.collection("beach_place");    
    const beachPlacesReservation = db.collection("beach_place_reservation");

    const filterReservations = {
        beachId: '4gZNmQXk',
        placeIndex: placeIndex + 1,
        date: date, // Keep the original Date object instead of converting it to a string
    };

    let placeToRemove = await beachPlacesReservation.findOne(filterReservations);

    // place to book is not booked yet
    if(placeToRemove !== null){    
        if(placeToRemove.userId === user.id){
            await beachPlacesReservation.deleteOne(placeToRemove);
            console.log("BEACH PLACE");

            let result = await beachPlaces.updateOne({index: 1}, {$pull: {reservations: date}});

            console.log(result);
        } else {
            throw new PlaceBookingDeletionNotPermitted();
        }
        
    } else {
        throw new PlaceNotBooked();
    }
}

async function getUserBookings(id){
    const db = client.db(DBNAME);
    const beachPlacesReservation = db.collection("beach_place_reservation");

    let bookings = await beachPlacesReservation.aggregate([
        {
            $lookup: {
                from: 'beach', // The second collection to join
                localField: 'beachId', // Field from beachPlacesReservation collection
                foreignField: 'id', // Field from beaches collection
                as: 'beachDetails' // Alias for the joined field
            }
        },
        {
            $unwind: '$beachDetails' // Deconstructs the array field from the second lookup
        },
        {
            $project: {
                _id: 0,
                qrData: 1,
                id: 1,
                userName: 1, 
                userSurname: 1,
                beachName: '$beachDetails.name',
                date: 1,
                placeRow: 1,
                placeIndex: 1, 
                chairs: 1, 
                price: 1, 
                added: 1
            }
        }
    ]).toArray();
    
    return bookings
}

async function getBookingRatios(){
    const db = client.db(DBNAME);   
    const beachPlaces = db.collection("beach_place");
    let startDate = new Date("05-27-2024");
    let bookingRatiosPerDay = [];
    let bookedPlaces;

    for(let i = 0; i < 140; i++){
        bookedPlaces = await beachPlaces.find({ reservations: {$in: [startDate] }}).toArray();
        bookingRatiosPerDay.push(bookedPlaces.length);
        startDate.setDate(startDate.getDate() + 1);
    }

    return bookingRatiosPerDay;
}


async function getPlaceList(){
    
    const db = client.db(DBNAME);   
    const beachPlaces = db.collection("beach_place");
    let placeList = [];

    let dbData = await beachPlaces.find({}).sort({ row: -1, index: 1 }).toArray();

    dbData.map((elem) => { 
        placeList.push({
            beachId: elem.beachId,
            row: elem.row,
            index: elem.index,
            reservations: elem.reservations
        })
    });

    let fila = 1;
    placeList.unshift(`${fila} Fila`);
    
    for(let i = 0; i < placeList.length; i++){
   
        if(i % 16 === 0 && i != 0){
            fila++;
            placeList.splice(i, 0, `${fila} Fila`);
        }
    }

   return placeList;
}

async function editUserInfo(data, sessionUser){
    const db = client.db(DBNAME);
    const user = db.collection("user"); 
    const updateFilter = { 
        $set: { 
            name: data["name"] ?? sessionUser.name, 
            surname: data["surname"] ?? sessionUser.surname,
            email: data["email"] ?? sessionUser.email
        }
    }
    
    console.log("SESSION USER");
    console.log(sessionUser);
    let update = await user.findOneAndUpdate({id: sessionUser.id}, updateFilter); 
   
    console.log("UPDATE AND FIND ONE");
    console.log(update);
    return update; 
    
}

export default { 
    signUp, 
    login, 
    makeReservation, 
    removeAllReservations,
    deleteReservation, 
    setPlaces, 
    getBookingRatios,
    getPlaceList,
    getUserBookings, 
    editUserInfo
};