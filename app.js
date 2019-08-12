require("dotenv").config();
const Twit = require("twit");
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const { DataStream } = require("scramjet");
const cors = require("cors");
const uuidv1 = require("uuid/v1");
const crisislex = require("./crisislex");

app.use(cors());

const T = new Twit({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
});
const twitterStream = T.stream("statuses/filter", {
  track: crisislex,
  language: "en"
});
const stream = new DataStream();
twitterStream.on("tweet", tweet => stream.write(tweet));
twitterStream.on("error", () => {
  stream.end("{error:true}");
  console.log("stream error");
});
twitterStream.on("done", () => stream.end());

app.get("/api", function(req, res, next) {
  res.writeHead(200, { "Content-Type": "application/xnd-json" });
  stream
    .filter(tweet => tweet.text.includes("RT") === false)
    .map(tweet => {
      let text = null;
      let image = null;
      if (tweet.truncated) {
        text = tweet.extended_tweet.full_text;
        if (tweet.extended_tweet.entities.media !== undefined) {
          image = tweet.extended_tweet.entities.media[0].media_url_https;
        }
      } else {
        text = tweet.text;
        if (tweet.entities.media !== undefined) {
          image = tweet.entities.media[0].media_url_https;
        }
      }
      return {
        id: uuidv1(),
        time: tweet.created_at,
        text: text,
        image: image
      };
    })
    .map(async tweet => {
      let classificationResult;
      await fetch("http://localhost:5000/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tweet: tweet.text })
      })
        .then(res => res.json())
        .then(json => (classificationResult = json));
      tweet.category = classificationResult.category;
      tweet.score = classificationResult.score;
      return tweet;
    })
    .filter(tweet => tweet.category !== "unrelated")
    .map(async tweet => {
      let geoparsingResult;
      await fetch("http://localhost:9090/api/v0/geotag", {
        method: "POST",
        body: tweet.text
      })
        .then(res => res.json())
        .then(json => (geoparsingResult = json));
      if (geoparsingResult.resolvedLocations.length > 0) {
        tweet.placeName = geoparsingResult.resolvedLocations[0].matchedName;
        tweet.location = [
          geoparsingResult.resolvedLocations[0].geoname.longitude,
          geoparsingResult.resolvedLocations[0].geoname.latitude
        ];
      }
      return tweet;
    })
    .filter(tweet => tweet.placeName !== undefined)
    .map(tweet => JSON.stringify(tweet))
    .toStringStream()
    .append("\n")
    .pipe(res);
});

module.exports = app;
