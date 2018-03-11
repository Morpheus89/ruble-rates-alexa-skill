const Alexa = require('alexa-sdk')
const AWS = require('aws-sdk')
const config = require('config')
const request = require('request')
const moment = require('moment')
const { rublePronunciation, kopeckPronunciation, dayPronunciation } = require('./ru')

const makePlainText = Alexa.utils.TextUtils.makePlainText
const makeImage = Alexa.utils.ImageUtils.makeImage

const APP_ID = config.get('API.appID')

const SKILL_NAME = 'Ruble Rates'
const GET_FACT_MESSAGE = ''
const HELP_MESSAGE = 'Say open ruble rates'
const HELP_REPROMPT = 'What can I help you with?'
const STOP_MESSAGE = 'Goodbye!'

const Polly = new AWS.Polly()
const S3 = new AWS.S3()
const DynamoDB = new AWS.DynamoDB()

const ru = moment().locale('ru')

/*-----------------------------------------------------------------------------
 *  API requests
 *----------------------------------------------------------------------------*/

const getRatesFromAPI = function() {
    return new Promise(resolve => {
        request.get(
            `${config.get('API.fixerAPI')}&access_key=${config.get('API.apiKey')}`,
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
        TableName: config.get('API.dynamoDBTableName'),
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
        TableName: config.get('API.dynamoDBTableName'),
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
        Bucket: config.get('API.s3BucketName'),
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

const synthesizeSpeech = function(ssmlText) {
    var params = {
        OutputFormat: 'mp3',
        // SampleRate: '16000',
        Text: ssmlText,
        TextType: 'ssml',
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
    const greetings = config.get('Greetings')
    return greetings[Math.floor(Math.random() * greetings.length)]
}

const randomWish = function(time) {
    const wishes = config.get('Wishes')
    return wishes[Math.floor(Math.random() * wishes.length)]
}

const currencyPronunciation = function(amount) {
    const parts = (amount + '').split('.')

    return (
        '<break strength="weak"/>' +
        rublePronunciation(parseInt(parts[0])) +
        '<break strength="weak"/>' +
        kopeckPronunciation(parseInt(parts[1]))
    )
}

const generateSpeechString = function(greeting, rates, wish) {
    const today = ru.format('D MMMM').split(' ')

    const date = `Сегодня ${dayPronunciation(today[0])} ${today[1]}`
    const day = ru.format('dddd')
    const dollarRates = `Курс американского доллара составляет ${currencyPronunciation(rates.USD)}`
    const euroRates = `Курс евро ${currencyPronunciation(rates.EUR)}`
    const yuanRates = `А курс китайской юани ${currencyPronunciation(rates.CNY)}`

    return `
    <speak>
        ${config.get('SSMLEffects')[0]}
            <p>${greeting}</p>
            <p>${date} '<break strength="weak"/> ${day}</p>
            <p>${dollarRates}</p>
            <p>${euroRates}</p>
            <p>${yuanRates}</p>
            <p>${wish}</p>
        ${config.get('SSMLEffects')[1]}
    </speak>`
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
                        // 1. audio file has already been generated
                        let audioURL = item.Item.url.S
                        resolve(audioURL)
                    } else {
                        // 2. no audio for current date
                        getRatesFromAPI()
                            .then(apiResponse => {
                                // generate all currencies
                                return Promise.resolve(calcCurrencyRates(apiResponse.rates))
                            })
                            .then(rates => {
                                return generateSpeechString(randomGreeting(), rates, randomWish())
                            })
                            // generate audio using Polly API and return stream
                            .then(synthesizeSpeech)
                            // upload generated file to S3 and return link
                            .then(uploadFileToS3)
                            // put link for generated file to DynamoDB
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
                            .catch(err => {
                                console.log('---', err, err.stack)
                            })
                    }
                })
            })
            .then(audioURL => {
                this.response.audioPlayerPlay('REPLACE_ALL', audioURL, 'audio')
                this.emit(':responseReady')
            })
            .catch(err => {
                console.log('---', err, err.stack)
            })
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
        this.response.speak(STOP_MESSAGE).audioPlayerPlay()
        this.emit(':responseReady')
    },
}

exports.handler = function(event, context, callback) {
    const alexa = Alexa.handler(event, context, callback)
    alexa.APP_ID = APP_ID
    alexa.registerHandlers(handlers)
    alexa.execute()
}
