const Alexa = require('alexa-sdk')
const AWS = require('aws-sdk')
const config = require('config')
const request = require('request')
const moment = require('moment')

const makePlainText = Alexa.utils.TextUtils.makePlainText
const makeImage = Alexa.utils.ImageUtils.makeImage

const APP_ID = config.get('appID')

const SKILL_NAME = 'Ruble Rates'
const GET_FACT_MESSAGE = ''
const HELP_MESSAGE = 'Say open ruble rates'
const HELP_REPROMPT = 'What can I help you with?'
const STOP_MESSAGE = 'Goodbye!'

const Polly = new AWS.Polly()
const S3 = new AWS.S3()
const DynamoDB = new AWS.DynamoDB()

/*-----------------------------------------------------------------------------
 *  API requests
 *----------------------------------------------------------------------------*/

const getRatesFromAPI = function() {
    return new Promise(resolve => {
        request.get(
            `${config.get('fixerAPI')}&access_key=${config.get('apiKey')}`,
            (error, response, body) => {
                if (response.statusCode === 200) {
                    resolve(JSON.parse(body))
                }
            }
        )
    })
}

// Gets item from DynamoDB using Key
const getItemFromDynamo = function(item) {
    var params = {
        Key: item,
        TableName: config.get('dynamoDBTableName'),
    }

    return new Promise((resolve, reject) => {
        DynamoDB.getItem(params, function(err, data) {
            if (err) console.log(err, err.stack)
            else resolve(data)
        })
    })
}

// Uploads item to DynamoDB storage
const putItemToDynamo = function(item) {
    var params = {
        Item: item,
        // ReturnConsumedCapacity: 'TOTAL',
        TableName: config.get('dynamoDBTableName'),
    }

    return new Promise(resolve => {
        DynamoDB.putItem(params, function(err, data) {
            if (err) console.log(err, err.stack)
            else resolve(data)
        })
    })
}

// Returns uploaded file location URL
const uploadFileToS3 = function(stream) {
    const params = {
        ACL: 'public-read',
        Bucket: config.get('s3BucketName'),
        Key: `briefings/${moment().format('YYYYMMDD')}.mp3`,
        Body: stream,
    }

    return new Promise(resolve => {
        S3.upload(params, function(err, data) {
            if (err) console.log(err, err.stack)
            else resolve(data.Location)
        })
    })
}

const synthesizeSpeech = function(text) {
    var params = {
        OutputFormat: 'mp3',
        SampleRate: '16000',
        Text: text,
        TextType: 'text',
        VoiceId: 'Maxim',
    }

    return new Promise(resolve => {
        Polly.synthesizeSpeech(params, function(err, data) {
            if (err) console.log(err, err.stack)
            else resolve(data.AudioStream)
        })
    })
}

/*-----------------------------------------------------------------------------
 *  Helpers
 *----------------------------------------------------------------------------*/

// Gets currency rates for EUR and calculates them for ruble
const calcCurrencyRates = function(rates) {
    return {
        USD: roundCurrencyRate(rates.RUB / rates.USD),
        EUR: roundCurrencyRate(rates.RUB),
        CNY: roundCurrencyRate(rates.RUB / rates.CNY),
    }
}

// Rounds number with precision = 2
const roundCurrencyRate = function(rate) {
    return Math.round(rate * 100) / 100
}

const randomGreeting = function(time) {
    const greetings = config.get('greetings')
    return greetings[Math.floor(Math.random() * greetings.length)]
}

const randomWish = function(time) {
    const wishes = config.get('wishes')
    return wishes[Math.floor(Math.random() * wishes.length)]
}

const generateSpeechString = function(greeting, rates, wish) {
    return `${greeting}. Курс доллара составляет ${rates.USD}, евро ${rates.EUR}, юани ${
        rates.CNY
    }. ${wish}`
}

/*-----------------------------------------------------------------------------
 *  Handlers
 *----------------------------------------------------------------------------*/

const handlers = {
    LaunchRequest: function() {
        this.emit('GetRatesIntent')
    },

    GetRatesIntent: function() {
        // check if Dynamo has link to audio
        getItemFromDynamo({
            id: {
                S: moment().format('YYYYMMDD'),
            },
        })
            .then(item => {
                return new Promise(resolve => {
                    if (item.Item) {
                        // audio file has already been generated
                        let audioURL = item.Item.url.S
                        resolve(audioURL)
                    } else {
                        // no audio for current date
                        getRatesFromAPI()
                            .then(apiResponse => {
                                console.log('---', 'got from api')
                                // generate all currencies
                                return Promise.resolve(calcCurrencyRates(apiResponse.rates))
                            })
                            .then(rates =>
                                generateSpeechString(randomGreeting(), rates, randomWish())
                            )
                            // generate audio using Polly API
                            .then(synthesizeSpeech)
                            .then(uploadFileToS3)
                            .then(audioURL => {
                                putItemToDynamo({
                                    id: {
                                        S: moment().format('YYYYMMDD'),
                                    },
                                    url: {
                                        S: audioURL,
                                    },
                                })

                                resolve(audioURL)
                            })
                    }
                })
            })
            .then(audioURL => {
                this.response.audioPlayerPlay('REPLACE_ALL', audioURL, 'audio')
                this.emit(':responseReady')
            })

        // const imageObj = {
        //     smallImageUrl: 'https://',
        //     largeImageUrl: 'https://',
        // }

        // const builder = new Alexa.templateBuilders.BodyTemplate1Builder()
        // console.log('---', 'get from api')

        // const template = builder
        //     .setTitle('Ruble Rates')
        //     // .setBackgroundImage(makeImage('https://'))
        //     .setTextContent(makePlainText('hi'))
        //     .build()

        // this.response
        //     .speak('Ok')
        //     .audioPlayerPlay(
        //         'REPLACE_ALL',
        //         'https://s3.eu-central-1.amazonaws.com/ruble-rates-assets/briefings/hello.mp3',
        //         'myAnswer'

        //         //     // 'expectedPreviousToken',
        //         //     // 0
        //     )
        // .cardRenderer('Title', JSON.stringify(rates))
        // .renderTemplate(template)
        // console.log('---', 'response ready')
    },
    'AMAZON.HelpIntent': function() {
        const speechOutput = HELP_MESSAGE
        const reprompt = HELP_REPROMPT

        this.response.speak(speechOutput).listen(reprompt)
        this.emit(':responseReady')
    },
    'AMAZON.CancelIntent': function() {
        this.response.speak(STOP_MESSAGE)
        this.emit(':responseReady')
    },
    'AMAZON.StopIntent': function() {
        this.response.speak(STOP_MESSAGE)
        this.emit(':responseReady')
    },
}

exports.handler = function(event, context, callback) {
    const alexa = Alexa.handler(event, context, callback)
    alexa.APP_ID = APP_ID
    alexa.registerHandlers(handlers)
    alexa.execute()
}
