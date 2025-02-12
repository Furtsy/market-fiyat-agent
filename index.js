import {
  pipeline,
  env
} from '@xenova/transformers';
import express from 'express';
import dotenv from 'dotenv';
import {
  readFileSync
} from 'fs';
import router from './router.js';
const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use('/', router);

const PORT = process.env.PORT || 3000;

dotenv.config();
env.cacheDir = './.cache';

const categoriesData = JSON.parse(readFileSync('./kategori.json', 'utf8'));
const {
  autoCategoryMappings
} = categoriesData;

function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

class AIAgent {
  constructor() {
      this.tools = {
          market: this.marketSearchTool.bind(this),
          kategori: this.categorySearchTool.bind(this),
          özetle: this.summarizeTool.bind(this)
      };

      this.history = [];
      this.initializeModels();
  }

  async initializeModels() {
      try {
          this.generator = await pipeline('text2text-generation', 'Xenova/t5-small');
          this.qa = await pipeline('question-answering', 'Xenova/distilbert-base-cased-distilled-squad');
          console.log('Modeller başarıyla yüklendi');
      } catch (error) {
          console.error('Model yükleme hatası:', error);
          throw new Error('Model yüklenemedi: ' + error.message);
      }
  }

  async summarizeTool(text) {
      try {
          const summary = await this.generator(text, {
              max_length: 120,
              num_return_sequences: 1
          });
          return summary[0].generated_text;
      } catch (error) {
          throw new Error('Özetleme başarısız: ' + error.message);
      }
  }

  async marketSearchTool(input) {
      try {
          let product = input.trim();
          if (product.toLowerCase().startsWith("market")) {
              product = product.substring("market".length).trim();
          }
          if (!product) {
              throw new Error('Lütfen aranacak ürün adını belirtin. Örneğin: "market iphone 13"');
          }
          const searchUrl = "https://api.marketfiyati.org.tr/api/v2/search";
          const payload = {
              keywords: product,
              pages: 0,
              size: 24,
              depots: []
          };

          const response = await fetch(searchUrl, {
              method: "POST",
              headers: {
                  "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
          });
          const data = await response.json();

          if (!data.numberOfFound || !data.content || data.content.length === 0) {
              return `Üzgünüm, "${product}" için uygun fiyat bilgisi bulunamadı.`;
          }

          let offers = [];
          data.content.forEach(item => {
              (item.productDepotInfoList || []).forEach(depot => {
                  const price = depot.price;
                  if (price != null) {
                      offers.push({
                          title: item.title,
                          price: price,
                          market: depot.marketAdi
                      });
                  }
              });
          });
          offers.sort((a, b) => a.price - b.price);
          const lowestOffers = offers.slice(0, 5);
          let resultStr = "En uygun 5 teklif:\n";
          lowestOffers.forEach((offer, index) => {
              resultStr += `${index + 1}. ${offer.title}: ${offer.price} TL - ${offer.market}\n`;
          });
          return resultStr.split('\n').join('\n');
      } catch (error) {
          throw new Error("Market araması başarısız: " + error.message);
      }
  }

  async categorySearchTool(query, menuCategoryProvided) {
      try {
          if (!query) {
              throw new Error('Lütfen kategori bilgisini belirtin.');
          }
          const lowerQuery = query.toLowerCase();
          const menuCategory = (typeof menuCategoryProvided === "boolean") ?
              menuCategoryProvided :
              !(lowerQuery.includes(","));
          const searchUrl = "https://api.marketfiyati.org.tr/api/v2/searchByCategories";
          const payload = {
              menuCategory: menuCategory,
              keywords: query,
              pages: 0,
              size: 24
          };

          const response = await fetch(searchUrl, {
              method: "POST",
              headers: {
                  "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
          });
          const data = await response.json();
          if (!data.numberOfFound || !data.content || data.content.length === 0) {
              return `Üzgünüm, "${query}" için kategori sonuç bulunamadı.`;
          }
          let offers = [];
          data.content.forEach(item => {
              (item.productDepotInfoList || []).forEach(depot => {
                  const price = depot.price;
                  if (price != null) {
                      offers.push({
                          title: item.title,
                          price: price,
                          market: depot.marketAdi
                      });
                  }
              });
          });
          offers.sort((a, b) => a.price - b.price);
          const lowestOffers = offers.slice(0, 5);
          let resultStr = "En uygun 5 kategori teklifi:\n";
          lowestOffers.forEach((offer, index) => {
              resultStr += `${index + 1}. ${offer.title}: ${offer.price} TL - ${offer.market}\n`;
          });
          return resultStr.split('\n').join('\n');
      } catch (error) {
          throw new Error("Kategori araması başarısız: " + error.message);
      }
  }

  async process(input) {
      let toolUsed = "";
      let result = "";
      const lowerInput = input.toLowerCase();

      if (lowerInput.startsWith("kategori")) {
          const query = input.substring("kategori".length).trim();
          let mappingFound = null;
          for (let mapping of autoCategoryMappings) {
              for (let keyword of mapping.keywords) {
                  const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
                  if (regex.test(query)) {
                      mappingFound = mapping;
                      break;
                  }
              }
              if (mappingFound) break;
          }
          if (mappingFound) {
              toolUsed = "kategori";
              result = await this.tools.kategori(mappingFound.category, mappingFound.menuCategory);
          } else {
              toolUsed = "kategori";
              result = await this.tools.kategori(query);
          }
      } else {

          const measurementUnits = ["litre", "ml", "kg", "gr", "adet", 'lt', 'gr', 'ml'];
          const containsMeasurement = measurementUnits.some(unit => lowerInput.includes(unit));
          if (containsMeasurement || /\d/.test(lowerInput)) {
              toolUsed = "market";
              result = await this.tools.market(input);
          } else {
              let mappingFound = null;
              for (let mapping of autoCategoryMappings) {
                  for (let keyword of mapping.keywords) {
                      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
                      if (regex.test(lowerInput)) {
                          mappingFound = mapping;
                          break;
                      }
                  }
                  if (mappingFound) break;
              }
              if (mappingFound) {
                  toolUsed = "kategori";
                  result = await this.tools.kategori(mappingFound.category, mappingFound.menuCategory);
              } else {
                  toolUsed = "market";
                  result = await this.tools.market(input);
              }
          }
      }

      this.history.push({
          girdi: input,
          düşünce: "Seçilen araç: " + toolUsed,
          işlem: toolUsed + " aracının çalıştırılması tamamlandı.",
          yanıt: result
      });

      return {
          düşünce: "Seçilen araç: " + toolUsed,
          işlem: toolUsed + " aracının çalıştırılması tamamlandı.",
          yanıt: result
      };
  }
}

app.locals.agent = new AIAgent();


app.listen(PORT, () => {
  console.log(`http://localhost:${PORT} 🐈‍⬛`);
});