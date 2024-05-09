class UserAlreadyPresent extends Error {
    constructor (message){
        super(message);
    }
}

class BadCredentials extends Error {
    constructor (message){
        super(message);
    }
}

class EmailNotPresent extends Error {
    constructor (message){
        super(message);
    }
}

export  { UserAlreadyPresent, EmailNotPresent, BadCredentials };