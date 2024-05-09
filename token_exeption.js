
// When the user send an invalid refresh token
// after an invalid access token has been provided
class SessionNotValid extends Error {
    constructor(message){
        this.message = message;
        this.err = null;
    }
}

class TokenNotValid extends Error {
    constructor(message){
        this.message = message;
    }
}

class TypeOfTokenNotValid extends Error {
    constructor(message){
        this.message = message;
    }
}


export {SessionNotValid, TokenNotValid, TypeOfTokenNotValid};