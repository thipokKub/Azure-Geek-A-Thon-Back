const express = require('express');
const app = express();
const Twitter = require('twitter');
const bodyParser = require('body-parser');
const Constant = require('./constant');

const client = new Twitter(Constant.twitter);

const MongoClient = require('mongodb').MongoClient;
const mongoose = require('mongoose');
const request = require('request');
const crypto = require('crypto');

app.use(bodyParser.json());

app.get('/', (req, res) => {
    const query = req.query.term || '';
    getText(query).then((tweets) => {
        return Array.from(new Set((tweets.statuses || []).map((item) => item.full_text)));
    }).then((data) => {

        new Promise((res, rej) => connectDB(Constant.mongo.dbName, (dbo) => {
            dbo.collection(Constant.mongo.cName.score).find({
                name: query
            }).toArray(function (err, result) {
                if (err) return rej(err);
                return res(result)
            })
        })).then((result) => {
            //Assume result is only 1 query at maximum
            updateObj(Constant.mongo.dbName, Constant.mongo.cName.score, { name: query }, {
                $set: {
                    corpus: {
                        ...(result.length > 0 ? result[0].corpus : {}),
                        ...data.reduce((obj, item) => {
                            return {
                                ...obj,
                                [crypto.createHash('md5').update(item).digest("hex")]: {
                                    text: item,
                                    score: -1
                                }
                            }
                        }, {})
                    }
                }
            })
        })

        res.send({
            name: query,
            status: "OK",
            count: data.length
        });
    })
});

app.get('/score', (req, res) => {
    getScore({
        res: res,
        query: req.query.term ? {
            name: req.query.term
        }  : {},
        lang: req.query.lang ? req.query.lang : Constant.azure_default_lang
    });
})

app.get('/sumScore', (req, res) => {
    new Promise((resolve, reject) => {
        const query = req.query.term || '';
        getText(query).then((tweets) => {
            return Array.from(new Set((tweets.statuses || []).map((item) => item.full_text)));
        }).then((data) => {
    
            new Promise((res, rej) => connectDB(Constant.mongo.dbName, (dbo) => {
                dbo.collection(Constant.mongo.cName.score).find({
                    name: query
                }).toArray(function (err, result) {
                    if (err) return rej(err);
                    return res(result)
                })
            })).then((result) => {
                //Assume result is only 1 query at maximum
                updateObj(Constant.mongo.dbName, Constant.mongo.cName.score, { name: query }, {
                    $set: {
                        corpus: {
                            ...(result.length > 0 ? result[0].corpus : {}),
                            ...data.reduce((obj, item) => {
                                return {
                                    ...obj,
                                    [crypto.createHash('md5').update(item).digest("hex")]: {
                                        text: item,
                                        score: -1
                                    }
                                }
                            }, {})
                        }
                    }
                })
                resolve(true);
            })
        })
    }).then(() => {
        getScore({
            res: res,
            query: req.query.term ? {
                name: req.query.term
            } : {},
            lang: req.query.lang ? req.query.lang : Constant.azure_default_lang
        });
    })
})

function countObj(obj) {
    let count = 0;
    for(props in obj) {
        count++;
    }
    return count;
}

function getScore(option) {
    option = option || {}
    query = option.query || {}
    res = option.res || {send: (() => {})};
    lang = option.lang || Constant.azure_default_lang;

    connectDB(Constant.mongo.dbName, (dbo) => {
        new Promise((resolve, reject) => {
            dbo.collection(Constant.mongo.cName.score).find(query).toArray((err, result) => {
                if (err) throw err;
                //create index reference
                const nameIndex = result.map((item) => item.name)
                let indexRef = result.map((item) => countObj(item.corpus))
    
                //divide all corpus into maximum size chunk
                const allChunks = result.map((item) => {
                    return Object.values(item.corpus).map((i) => i.text);
                }).reduce((arr, item) => {
                    arr = arr.concat(item);
                    return arr;
                }, []);

                let chunks = [];
                for (i = 0, j = allChunks.length; i < j; i += Constant.azure_max) {
                    chunks.push(allChunks.slice(i, i + Constant.azure_max));
                }
    
                //get score info + process score into original format
                let newObj = Array.from(result);
                getScoreAzure(chunks, lang).then((results) => {
                    //combine results
                    const newChunks = results.reduce((arr, item) => {
                        arr = arr.concat(item);
                        return arr;
                    }, [])
                    

                    //put all chunk back together

                    let newChunksIdx = 0;
                    for (let i = 0; i < indexRef.length; i++) {
                        let avg = 0;
                        let countItem = 0;
                        let newCorpus = [];
                        const oldCorpus = Object.values(result[i].corpus).map((i) => i.text)
                        while (indexRef[i] > 0) {
                            const item = newChunks.shift() || {}
                            avg += parseFloat(item.score);
                            countItem++;
                            newCorpus[crypto.createHash('md5').update(oldCorpus[oldCorpus.length - indexRef[i]]).digest("hex")] = {
                                text: oldCorpus[oldCorpus.length - indexRef[i]],
                                score: item.score
                            }
                            indexRef[i]--;
                        }

                        newObj[i] = {
                            ...newObj[i],
                            corpus: {
                                ...newCorpus
                            },
                            score: avg/countItem,
                            balancedScore: (avg/countItem - 0.25)/(0.75 - 0.25)
                        }
                    }

                    resolve(newObj)
                });
            })
        }).then((data) => {
            data.forEach((item) => {
                dbo.collection(Constant.mongo.cName.score).update(
                    { _id: item._id },
                    item,
                    { upsert: true, safe: false },
                    (err, res) => {
                        if (err) throw err;
                    }
                )
            })
            
            res.send(data)
        });
    });
}

function getScoreAzure(textChuk, lang) {
    const PromisePool = textChuk.map((textBulk) => {
        return (
        new Promise((res, rej) => {
            request.post({
                url: `https://eastasia.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment`,
                headers: {
                    "Content-Type": "application/json",
                    "Ocp-Apim-Subscription-Key": Constant.azure_text_key
                },
                body: JSON.stringify({
                    "documents": textBulk.map((text, index) => {
                        return ({
                            "language": lang || Constant.azure_default_lang,
                            "id": String(index + 1),
                            "text": text
                        });
                    })
                })
            }, (error, response, body) => {
                res(JSON.parse(body).documents)
            })
        }))
    })

    return Promise.all(PromisePool)
}

function getText(query) {
    return new Promise((resolve, reject) => {
        client.get('search/tweets', {
            q: query,
            count: 100,
            tweet_mode: "extended"
        }, function (error, tweets, response) {
            resolve(tweets);
        });
    })
}

function connectDB(dbName, callback) {
    MongoClient.connect(Constant.mongo.url, (err, db) => {
        if (err) throw err;
        const dbo = db.db(dbName);
        const rObj = callback(dbo);
        // db.close();
        return rObj;
    })
}

function updateObj(dbName, cName, query, object) {
    connectDB(dbName, (dbo) => {
        dbo.collection(cName).update(
            query,
            object,
            { upsert: true, safe: false },
            (err, res) => {
                if (err) throw err;
            }
        )
    })
}

function insertObj(dbName, cName, object) {
    connectDB(dbName, (dbo) => {
        dbo.collection(cName).insertOne(object, (err, res) => {
            if (err) throw err;
        })
    })
}

function insertObjs(dbName, cName, objects) {
    connectDB(dbName, (dbo) => {
        dbo.collection(cName).insertMany(objects, (err, res) => {
            if (err) throw err;
        })
    })
}

app.listen(3000, () => console.log('Example app listening on port 3000!'));
