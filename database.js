import { MongoClient, ServerApiVersion } from "mongodb";
import { UserAlreadyPresent, EmailNotPresent, BadCredentials } from "./auth_expetion.js";
import { promisify } from 'util';
import { compare, genSalt, hash as _hash } from "bcrypt";
import ShortUniqueId from "short-unique-id";
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
        genSalt(10, function(err, salt) {
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

async function makeReservation(user, row, placeIndex, date){
    const db = client.db(DBNAME);
    const beachPlaces = db.collection("beach_place");    
    const beachPlacesReservation = db.collection("beach_place_reservation");

    const filterReservations = {
        beachId: '4gZNmQXk',
        placeRow: row,
        placeIndex: placeIndex + 1,
        date: date
    };

    let placeToBook = await beachPlacesReservation.findOne(filterReservations);
    let bookingId = new ShortUniqueId({ length: 10 })

    // place to book is not booked yet
    if(placeToBook === null){
        const booking = {
            id: bookingId.randomUUID(),
            beachId: '4gZNmQXk',
            userId: user.id,
            date: date,
            placeRow: row,
            placeIndex: placeIndex + 1
        }

        await beachPlacesReservation.insertOne(booking);
        await beachPlaces.updateOne({index: placeIndex + 1, row: row}, {$addToSet: {reservations: date}});
    
    } else {
        throw new PlaceAlreadyBooked();
    }
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

export default { 
    signUp, 
    login, 
    makeReservation, 
    deleteReservation, 
    setPlaces, 
    getBookingRatios,
    getPlaceList
};