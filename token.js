
import User from "./models/user.js";
import jwt from "jsonwebtoken";
import { readFileSync } from 'fs';
import { SessionNotValid, TokenNotValid, TypeOfTokenNotValid } from "./token_exeption.js";

// Private key to sign jwt
const privateKey = readFileSync('priv.key');

function generateIdToken( user ){
    const info = new User(user.name, user.surname, user.email, user.tel);
    
    let token = jwt.sign({ info }, privateKey, { algorithm: 'RS256', expiresIn: '0s'});
    return token;
}

function generateAccessToken(userId) {
    return jwt.sign({ type: 'access', user_id: userId }, privateKey, { algorithm: 'RS256', expiresIn: '1h' });    
}

function generateRefreshToken(userId) {
    return jwt.sign({ type: 'refresh', user_id: userId }, privateKey, { algorithm: 'RS256', expiresIn: '2h' });
}

function validateAccessToken(token) {
    let decodedToken;
    try{
        decodedToken = jwt.verify(token, privateKey, { algorithm: 'RS256' });
    } catch {
        throw new TokenNotValid()
    }
      
    if(decodedToken.type === "access"){
        return true;
    }
    throw new TypeOfTokenNotValid();
}

function validateRefreshToken(token) {
    let decodedToken;
    try{
        decodedToken = jwt.verify(token, privateKey, { algorithm: 'RS256' });
    } catch {
        throw new TokenNotValid()
    }
      
    if(decodedToken.type === "refresh"){
        return true;
    }
    throw new TypeOfTokenNotValid();

}

function renewTokens(token){
    let decodedToken = decode(token);
    if(decodedToken.type === "refresh"){
        try{
            if(validateAccessToken(token)){
                return {
                    "access_token" : generateAccessToken(decodedToken.user_id),
                    "refresh_token" : generateRefreshToken(decodedToken.user_id)
                }
            }
        } catch(err){
            throw new SessionNotValid(err);
        }
    } else {
        throw new TypeOfTokenNotValid();
    }
}

export default { 
    generateIdToken, 
    generateAccessToken, 
    generateRefreshToken,
    validateAccessToken,
    validateRefreshToken,
    renewTokens
};