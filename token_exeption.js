class ChangePasswordTokenNotValid extends Error {}

class ChangePasswordTokenExpired extends Error {}

class ChangePasswordTokenAlreadyPresent extends Error {}

export { ChangePasswordTokenNotValid, ChangePasswordTokenExpired, ChangePasswordTokenAlreadyPresent };