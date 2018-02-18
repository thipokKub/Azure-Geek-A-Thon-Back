let Exports = {}

Exports.twitter = {
    consumer_key: 'zcprKquLqEQvdn6rnXgZ7KqEb',
    consumer_secret: '8qQixbq0y52Wls43k5jWYz4i6GWc62L4PHX0K97BOnsY4wNgeC',
    access_token_key: '804129707515998208-pRA1GXdX9lfaTNogtZydS5dV8uUi51e',
    access_token_secret: 'vhOxG9YB1au0MtAkjY22pYzItkmym5TCOxAuOa9R8eSW1'
}

Exports.mongo = {
    url: "mongodb://localhost:27017/",
    port: 27017,
    dbName: "geekathon",
    cName: {
        location: "location_db",
        score: "score_db"
    },
    userInfo: {
        user: 'dernpu',
        pwd: "neversleep",
        roles: ["readWrite", "dbAdmin"]
    },
}

Exports.azure_max = 100;
Exports.azure_text_key = '6a65a211209d45f6971a9e9caf0b6912';
Exports.azure_default_lang = 'ja';

module.exports = Exports;