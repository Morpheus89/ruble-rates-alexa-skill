const Alexa = require('alexa-sdk')
const AWS = require('aws-sdk')
const polly = new AWS.Polly()
const config = require('config')
const request = require('request')

const makePlainText = Alexa.utils.TextUtils.makePlainText
const makeImage = Alexa.utils.ImageUtils.makeImage

const APP_ID = config.get('appID')

const SKILL_NAME = 'Ruble Rates'
const GET_FACT_MESSAGE = ''
const HELP_MESSAGE = 'Say open ruble rates'
const HELP_REPROMPT = 'What can I help you with?'
const STOP_MESSAGE = 'Goodbye!'

// check if Dynamo has link to audio
// if link => generate response
// if no link => get quotes
// generate all currencies
// generate response string
// invoke polly and save audio to s3 "20180309.mp3"
// on success save link to dynamo
// generate response

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

const generateSpeechURL = function(text) {
    // var params = {
    // };
    // polly.listLexicons(params, function(err, data) {
    //   if (err) console.log(err, err.stack); // an error occurred
    //   else     console.log(data);           // successful response
    //   /*
    //   data = {
    //    Lexicons: [
    //       {
    //      Attributes: {
    //       Alphabet: "ipa",
    //       LanguageCode: "en-US",
    //       LastModified: <Date Representation>,
    //       LexemesCount: 1,
    //       LexiconArn: "arn:aws:polly:us-east-1:123456789012:lexicon/example",
    //       Size: 503
    //      },
    //      Name: "example"
    //     }
    //    ]
    //   }
    //   */
    // });

    var params = {
        // LexiconNames: ['example'],
        OutputFormat: 'json',
        SampleRate: '8000',
        Text: text,
        TextType: 'text',
        VoiceId: 'Maxim',
    }
    polly.synthesizeSpeech(params, function(err, data) {
        if (err)
            console.log(err, err.stack) // an error occurred
        else console.log(data) // successful response
        /*
         data = {
          AudioStream: <Binary String>, 
          ContentType: "audio/mpeg", 
          RequestCharacters: 37
         }
         */
    })
}

const handlers = {
    LaunchRequest: function() {
        this.emit('GetRatesIntent')
    },
    GetRatesIntent: function() {
        const imageObj = {
            smallImageUrl: 'https://',
            largeImageUrl: 'https://',
        }

        const builder = new Alexa.templateBuilders.BodyTemplate1Builder()

        getRatesFromAPI().then(response => {
            const rates = calcCurrencyRates(response.rates)

            const template = builder
                .setTitle('Hello')
                .setBackgroundImage(makeImage('https://'))
                .setTextContent(makePlainText('Hi'))
                .build()

            this.response
                .speak('Ok')
                // .audioPlayerPlay(
                //     'REPLACE_ALL',
                //     'https://s3.eu-central-1.amazonaws.com/ruble-rates-assets/briefings/hello.mp3',
                //     'myAnswer'

                //     // 'expectedPreviousToken',
                //     // 0
                // )
                .cardRenderer('Title', JSON.stringify(rates), imageObj)
                .renderTemplate(template)

            this.emit(':responseReady')
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
