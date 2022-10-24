import axios from 'axios';
import { ethers, BigNumber } from 'ethers';
import { ADDRESS_TO_CURRENCY, ORACLE_URL } from './handle-config';

type SignedQuote = {
  /// The quote pair. eg: Pair { base: "AUD", quote: "USD" } for "AUD/USD"
  symbol: string;
  signatureParams: SignedQuoteParams;
  signature: Uint8Array;
};

type SignedQuoteParams = {
  /// The value of the quote, with 8 decimals. eg: 100000000 for 1 AUD/USD
  value: BigNumber;
  signedTimestamp: BigNumber;
  chainId: number;
  validFromTimestamp: BigNumber;
  durationSeconds: BigNumber;
};

type QuoteApiResponseSigned = {
  data: {
    /// Quote value as an 8 decimal number.
    result: number;
    signed: {
      signatureParams: {
        signedTimestamp: number;
        chainId: number;
        /// Timestamp from which the quote is valid. Seconds since unix epoch.
        validFromTimestamp: number;
        durationSeconds: number;
      };
      /// Hex-encoded signature.
      signature: string;
      /// Hex-encoded unsigned message.
      message: string;
    };
  };
};

export const fetchEncodedSignedQuotes = async (
  tokens: string[],
): Promise<string> => {
  const signedQuotes = await fetchSignedQuotes(
    tokens.map(t => ADDRESS_TO_CURRENCY[t]),
  );
  return encodeQuotes(signedQuotes);
};

const fetchH2soQuote = async (symbol: string) => {
  // The only base symbol that can be requested as fxToken is fxUSD.
  const result = await axios.get(`${ORACLE_URL}/${symbol}/USD?sign=true`);
  return result.data;
};

const fetchSignedQuotes = async (symbols: string[]): Promise<SignedQuote[]> => {
  type Response = QuoteApiResponseSigned & { pairIndex: number };
  const responses: Response[] = [];
  const requests = symbols.map(async (symbol, i) => {
    const response = await fetchH2soQuote(symbol);
    if (response.data.signed) {
      responses.push({ ...(response as QuoteApiResponseSigned), pairIndex: i });
    } else {
      throw new Error(`No signature returned for ${symbol}`);
    }
  });
  await Promise.all(requests);
  return responses.map(response => {
    return quoteApiResponseToSignedQuote(symbols[response.pairIndex], response);
  });
};

const quoteApiResponseToSignedQuote = (
  symbol: string,
  {
    data: {
      result,
      signed: { signatureParams, signature, message },
    },
  }: QuoteApiResponseSigned,
): SignedQuote => {
  return {
    symbol,
    signature: signature.startsWith('0x')
      ? ethers.utils.arrayify(signature)
      : ethers.utils.arrayify(`0x${signature}`),
    signatureParams: {
      value: BigNumber.from(result),
      signedTimestamp: BigNumber.from(signatureParams.signedTimestamp),
      chainId: signatureParams.chainId,
      validFromTimestamp: BigNumber.from(signatureParams.validFromTimestamp),
      durationSeconds: BigNumber.from(signatureParams.durationSeconds),
    },
  };
};

const encodeQuotes = (quotes: SignedQuote[]): string => {
  const concatenatedSignatures = quotes.reduce((buffer, quote, i) => {
    for (let j = 0; j < 65; j++) {
      const offset = i * 65;
      buffer[offset + j] = quote.signature[j];
    }
    return buffer;
  }, new Uint8Array(quotes.length * 65));
  const tokenAddresses = quotes.map(
    quote =>
      Object.entries(ADDRESS_TO_CURRENCY).find(([_address, symbol]) => {
        return symbol === quote.symbol;
      })?.[0]!,
  );
  return ethers.utils.defaultAbiCoder.encode(
    [
      'uint256',
      'address[]',
      'uint256[]',
      'uint256[]',
      'uint256[]',
      'uint256[]',
      'bytes',
    ],
    [
      tokenAddresses.length,
      tokenAddresses,
      quotes.map(quote => quote.signatureParams.value),
      quotes.map(quote => quote.signatureParams.signedTimestamp),
      quotes.map(quote => quote.signatureParams.validFromTimestamp),
      quotes.map(quote => quote.signatureParams.durationSeconds),
      concatenatedSignatures,
    ],
  );
};
