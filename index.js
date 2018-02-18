const express = require('express');
const app = express();
const Twitter = require('twitter');
const bodyParser = require('body-parser');
const Constant = require('./constant');

const client = new Twitter(Constant.twitter);

const MongoClient = require('mongodb').MongoClient;
const mongoose = require('mongoose');
const request = require('request');
// const Admin = mongoose.mongo.Admin;

String.prototype.hashCode = function () {
    var hash = 0, i, chr;
    if (this.length === 0) return hash;
    for (i = 0; i < this.length; i++) {
        chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

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
                                [item.hashCode()]: {
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
            status: "OK"
        });
    })
});

function countObj(obj) {
    let count = 0;
    for(props in obj) {
        count++;
    }
    return count;
}

function getScore(query) {
    query = query || {}

    connectDB(Constant.mongo.url, (dbo) => {
        new Promise((resolve, reject) => {
            dbo.collection(Constant.mongo.cName.score).find(query).toArray((err, result) => {
                if (err) throw err;
                //create index reference
                const nameIndex = result.map((item) => item.name)
                let indexRef = result.map((item) => countObj(item))
    
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

                // const chunks = result.reduce((arr, item) => {
                //     //convert corpus from object to array
                //     corpus = Object.values(item.corpus).map((i) => i.text)
    
                //     //Too Lazy to optimize
                //     while (corpus.length > 0) {
                //         while (arr[arr.length - 1].length < Constant.azure_maximum && corpus.length > 0) {
                //             arr[arr.length - 1] = arr[arr.length - 1].concat([corpus.shift()])
                //         }
                //         if (arr[arr.length - 1].length >= Constant.azure_maximum) {
                //             arr = arr.concat([])
                //         }
                //     }
                //     return arr;
                // }, [[]]);
    
                //get score info + process score into original format
                const results = chunks;
    
                //combine results
                const newChunks = results.reduce((arr, item) => {
                    arr = arr.concat(item);
                    return arr;
                }, [])
    
                //put all chunk back together
                //Buggy
                let newObj = Array.from(result);
                let newChunksIdx = 0;
                for(let i = 0; i < indexRef.length; i++) {
                    let newCorpus = [];
                    const oldCorpus = Object.values(result[nameIndex[i]].corpus).map((i) => i.text)
                    while(indexRef[i] > 0) {
                        newCorpus[oldCorpus[oldCorpus.length - indexRef[i]].hashCode] = {
                            text: oldCorpus[oldCorpus.length - indexRef[i]],
                            score: newChunks[newChunksIdx].shift().score
                        }
                        if(newChunks[newChunksIdx] === 0) {
                            newChunksIdx++;
                        }
                        indexRef[i]--;
                    }
                    
                    newObj[i] = {
                        ...newObj[i],
                        corpus: newCorpus
                    }
                }
    
                resolve(newObj)
            })
        })
    });
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
        db.close();
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
