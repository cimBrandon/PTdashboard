import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import Papa from 'papaparse';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Bar
} from 'recharts';

const SecurityChart = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Add S3 base URL with CORS proxy
  const S3_BASE_URL = 'https://corsproxy.io/?' + encodeURIComponent('https://cimseclist2075.s3.us-east-2.amazonaws.com/output/');

  const calculateSMA = (data, periods) => {
    return data.map((item, index) => {
      if (index < periods - 1) return null;
      const sum = data
        .slice(index - periods + 1, index + 1)
        .reduce((acc, curr) => acc + curr.close, 0);
      return sum / periods;
    });
  };

  const loadSecurityData = async (symbol) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Update fetch URL to use S3
      const response = await fetch(`${S3_BASE_URL}${symbol}_data.csv`);
      if (!response.ok) {
        console.error(`Failed to fetch ${symbol}_data.csv:`, response.status);
        throw new Error(`Security data not found for ${symbol}`);
      }

      const csvText = await response.text();
      if (!csvText || csvText.trim().length === 0) {
        throw new Error('Empty data received');
      }

      console.log(`Data received for ${symbol}, first 100 chars:`, csvText.substring(0, 100));

      const results = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        error: (error) => {
          console.error('Papa Parse error:', error);
          throw new Error('Failed to parse CSV data');
        }
      });

      if (!results.data || results.data.length === 0) {
        throw new Error('No valid data found in CSV');
      }

      const rawData = results.data
        .filter(row => row.Close && row.Date)
        .map(row => ({
          date: new Date(row.Date).toLocaleDateString(),
          close: Number(row.Close),
          volume: Number(row.Volume),
          cvi: Number(row.CVI)
        }));

      const sma200 = calculateSMA(rawData, 200);
      const sma50 = calculateSMA(rawData, 50);

      const processedData = rawData
        .slice(-250)
        .map((row, index) => {
          const absoluteIndex = rawData.length - 250 + index;
          const prevClose = index > 0 ? rawData[absoluteIndex - 1].close : row.close;
          
          return {
            ...row,
            sma200: sma200[absoluteIndex],
            sma50: sma50[absoluteIndex],
            isUp: row.close > prevClose
          };
        });

      setChartData(processedData);
      setSelectedSecurity(symbol);
    } catch (error) {
      console.error("Data loading error:", error);
      setError(error.message);
      setChartData([]);
      setSelectedSecurity(null);
    } finally {
      setIsLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-200 rounded p-2 shadow-lg">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-sm font-bold">Close: ${data.close.toFixed(2)}</p>
          {data.sma200 && <p className="text-sm">SMA200: ${data.sma200.toFixed(2)}</p>}
          {data.sma50 && <p className="text-sm">SMA50: ${data.sma50.toFixed(2)}</p>}
        </div>
      );
    }
    return null;
  };

  const renderCharts = () => {
    if (!chartData.length) return null;

    const priceMin = Math.min(...chartData.map(d => Math.min(d.close, d.sma200 || d.close, d.sma50 || d.close)));
    const priceMax = Math.max(...chartData.map(d => Math.max(d.close, d.sma200 || d.close, d.sma50 || d.close)));
    const volumeMax = Math.max(...chartData.map(d => d.volume));
    const cviMax = Math.max(...chartData.map(d => d.cvi));

    const formatYAxis = (value) => Math.round(value);

    const sections = [
      {
        // Price Chart
        height: 400,
        content: (
          <>
            <Line
              type="linear"
              dataKey="sma200"
              stroke="#0000ff"
              dot={false}
              strokeWidth={1}
            />
            <Line
              type="linear"
              dataKey="sma50"
              stroke="#00ff00"
              dot={false}
              strokeWidth={1}
            />
            <Line
              type="linear"
              dataKey="close"
              stroke="#000"
              dot={false}
              strokeWidth={2}
            />
          </>
        ),
        yDomain: [priceMin, priceMax]
      },
      {
        // Volume Chart
        height: 100,
        content: (
          <Bar
            dataKey="volume"
            fillOpacity={0.8}
            shape={(props) => {
              const { x, y, width, height, payload } = props;
              return (
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={payload.isUp ? "#22c55e" : "#ef4444"}
                />
              );
            }}
          />
        ),
        yDomain: [0, volumeMax]
      },
      {
        // CVI Chart
        height: 100,
        content: (
          <Line
            type="monotone"
            dataKey="cvi"
            stroke="#82ca9d"
            dot={false}
          />
        ),
        yDomain: [0, cviMax]
      }
    ];

    return sections.map((section, index) => (
      <div key={index} className="mb-4" style={{ height: section.height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 50, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              interval={Math.floor(chartData.length / 10)}
            />
            <YAxis
              tickFormatter={formatYAxis}
              domain={section.yDomain}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            {section.content}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    ));
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Search Bar */}
      <div className="w-1/2 flex items-center bg-white rounded-lg shadow p-4">
        <div className="flex-1 flex items-center bg-gray-100 rounded-md px-3">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Enter security symbol..."
            className="flex-1 bg-transparent border-none focus:outline-none px-3 py-2"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && searchTerm) {
                loadSecurityData(searchTerm);
              }
            }}
          />
        </div>
        <button
          className="ml-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          onClick={() => searchTerm && loadSecurityData(searchTerm)}
        >
          Load Chart
        </button>
      </div>

      {/* Chart Area */}
      <div className="w-1/2 bg-white rounded-lg shadow p-4">
        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            Loading...
          </div>
        ) : error ? (
          <div className="h-96 flex items-center justify-center text-red-500">
            {error}
          </div>
        ) : selectedSecurity ? (
          <div>
            <h2 className="text-xl font-semibold mb-4">{selectedSecurity}</h2>
            {renderCharts()}
          </div>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-500">
            Enter a security symbol to view chart
          </div>
        )}
      </div>
    </div>
  );
};

export default SecurityChart;