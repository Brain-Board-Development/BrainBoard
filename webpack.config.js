const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => ({
  mode: argv.mode || 'development',
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: /node_modules\/(?!(@react-native|react-native|react-native-web|@react-navigation|@react-native-async-storage|firebase|@react-native-google-signin)\/)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['module:metro-react-native-babel-preset'],
          },
        },
      },
      {
        test: /\.(png|jpg|gif)$/,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]',
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      favicon: './assets/favicon.png',
    }),
  ],
  resolve: {
    extensions: ['.js', '.jsx', '.web.js', '.web.jsx', '.ts', '.tsx'],
    alias: {
      'react-native$': 'react-native-web',
      '@react-native-async-storage/async-storage': path.resolve(
        __dirname,
        'node_modules/@react-native-async-storage/async-storage/lib/commonjs/index.web.js'
      ),
    },
    fullySpecified: false,
  },
  devServer: {
    static: path.join(__dirname, 'build'),
    port: 3000,
    historyApiFallback: true,
  },
});